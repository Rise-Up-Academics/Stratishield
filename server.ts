import express = require('express');
import cors = require('cors');
import dotenv = require('dotenv');
import crypto = require('crypto');
import childProcess = require('child_process');
import path = require('path');

const { spawn } = childProcess;
const { join } = path;

// ---------------------------------------------
// Server setup and configuration
// ---------------------------------------------
// Load local environment settings before reading credentials or service URLs.
dotenv.config();

const app = express();
// Allow browser clients to call this API and parse bounded JSON request bodies.
app.use(cors()); // BEN: RESTRICT THIS BEFORE DEPLOYMENT
app.use(express.json({ limit: '512kb' }));

type MicrosoftSessionHandoff = {
    accessToken: string;
    profile: Record<string, unknown>;
    expiresAt: number;
};

const microsoftSessionHandoffs = new Map<string, MicrosoftSessionHandoff>();

app.get('/microsoft-auth.html', (_req, res) => {
    res.sendFile('microsoft-auth.html', { root: __dirname });
});
app.get('/App.js', (_req, res) => {
    res.sendFile('App.js', { root: __dirname });
});
app.get('/developer-mode.js', (_req, res) => {
    res.sendFile('developer-mode.js', { root: __dirname });
});

// Keep development authentication bypass opt-in and unavailable in production.
const DEVELOPER_MODE =
    process.env.NODE_ENV?.toLowerCase() !== 'production' &&
    process.env.DEVELOPER_MODE?.toLowerCase() === 'true';

// Google OAuth needs a server-side secret; Microsoft browser sign-in only needs public IDs.
const CLIENT_ID = "423278388631-b9tk58lpag1ioq47uou0capsnvj898ii.apps.googleusercontent.com";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID
const MICROSOFT_ALLOWED_EMAILS = new Set(
    (process.env.MICROSOFT_ALLOWED_EMAILS ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
);
const INTERN_BASE_URL = process.env.INTERN_BASE_URL ?? 'https://chief-of-staff-aggregator.onrender.com';
const INTERN_KEY = process.env.INTERN_KEY;
const AI_PYTHON_EXECUTABLE = 
    process.env.PYTHON_EXECUTABLE ??
    join(
        __dirname,
        '.venv',
        process.platform === 'win32' ? 'Scripts' : 'bin',
        process.platform === 'win32' ? 'python.exe' : 'python',
    );
const AI_SCRIPT_PATH = join(__dirname, 'main.py');
const CHAT_ACTION_TTL_MS = 5 * 60_000;
const CHAT_WRITE_TOOL_NAMES = new Set([
    'create_email_draft',
    'send_email',
    'reply_to_email',
    'forward_email',
    'delete_email',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
]);

type PendingChatAction = {
    name: string;
    arguments: Record<string, unknown>;
    summary: string;
    accessTokenHash: Buffer;
    expiresAt: number;
};

const pendingChatActions = new Map<string, PendingChatAction>();

const runPython = (
    args: string[],
    payload: unknown,
    timeoutMs: number,
):
    Promise<Record<string,unknown>> =>
    new Promise((resolve, reject) => {
        const python = spawn(AI_PYTHON_EXECUTABLE, [AI_SCRIPT_PATH, ...args], {
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        // Ensure process only resolves or rejects once, so that the timeout and process exit don't both trigger.
        const finish = (complete: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            complete();
        };
        // If it takes too long, kill it.
        const timeout = setTimeout(() => {
            python.kill();
            finish(() => reject(new Error('AI request timed out.')));
        }, timeoutMs);

        python.stdout.setEncoding('utf8');
        python.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            if (stdout.length > 1_000_000) {
                python.kill();
                finish(() => reject(new Error('AI response is too large.')));
            }
        });
        python.stderr.setEncoding('utf8');
        python.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });
        python.on('error', (error) => finish(() => reject(error)));
        python.on('close', (code) => {
            if (settled) return;
            if (code !== 0) {
                finish(() =>
                    reject(
                        new Error(
                            `Python AI process exited with code ${code}. ${stderr.slice(-4_000)}`,
                        ),
                    ),
                );
                return;
            }
            try {
                const result: unknown = JSON.parse(stdout);
                if (!result || typeof result !== 'object' || Array.isArray(result)) {
                    throw new Error('Python AI returned an invalid response.');
                }
                finish(() => resolve(result as Record<string, unknown>));
            } catch (error) {
                finish(() =>
                    reject(
                        error instanceof Error
                            ? error
                            : new Error('Python AI returned invalid JSON.'),
                    ),
                );
            }
        });
        python.stdin.on('error', (error) => finish(() => reject(error)));
        python.stdin.end(JSON.stringify(payload));
    });

app.get('/api/config', (_req, res) => {
    res.json({ developerMode: DEVELOPER_MODE });
});

app.post('/api/microsoft/session-handoffs', (req, res) => {
    const { accessToken, profile } = req.body as {
        accessToken?: unknown;
        profile?: unknown;
    };
    if (
        typeof accessToken !== 'string' ||
        accessToken.length === 0 ||
        accessToken.length > 16_384 ||
        typeof profile !== 'object' ||
        profile === null ||
        Array.isArray(profile) ||
        JSON.stringify(profile).length > 16_384
    ) {
        res.status(400).json({ error: 'Microsoft sign-in handoff is invalid.' });
        return;
    }

    const handoffId = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60_000;
    microsoftSessionHandoffs.set(handoffId, {
        accessToken,
        profile: profile as Record<string, unknown>,
        expiresAt,
    });
    const expiryTimer = setTimeout(() => microsoftSessionHandoffs.delete(handoffId), 60_000);
    expiryTimer.unref();
    res.status(201).json({ handoffId });
});

app.post('/api/microsoft/session-handoffs/:handoffId/consume', (req, res) => {
    const handoffId = req.params.handoffId;
    const handoff = microsoftSessionHandoffs.get(handoffId);
    microsoftSessionHandoffs.delete(handoffId);
    if (!handoff || handoff.expiresAt <= Date.now()) {
        res.status(404).json({ error: 'Microsoft sign-in handoff expired or was already used.' });
        return;
    }

    res.json({ accessToken: handoff.accessToken, profile: handoff.profile });
});

// ---------------------------------------------
// Microsoft sign-in configuration
// ---------------------------------------------
// Return only the public values the browser needs to build the Microsoft authorization URL.
// This route fails closed if either value is missing, rather than choosing a broader default tenant.
app.get('/api/microsoft-config', (_req, res) => {
    require('crypto').randomUUID(); // since were routing through the server, RUUID is generated. Precaution to avoid exposing tenant.
    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_TENANT_ID) {
        res.status(503).json({ error: 'Microsoft OAuth is not configured.' });
        return;
    }

    res.json({
        clientId: MICROSOFT_CLIENT_ID,
        tenantId: MICROSOFT_TENANT_ID,
    });
});

// ---------------------------------------------
// Microsoft API authentication and authorization
// ---------------------------------------------
// Verify the caller's bearer token with Microsoft Graph and enforce the configured tenant.
// When an account allowlist is configured, it further restricts access within that tenant.
const requireMicrosoftAuth: express.RequestHandler = async (req, res, next) => {
    if (DEVELOPER_MODE) {
        next();
        return;
    }

    if (!MICROSOFT_TENANT_ID) {
        res.status(503).json({ error: 'Microsoft API access is not configured.' });
        return;
    }

    const authorization = req.header('Authorization');
    const bearerMatch = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    const accessToken = bearerMatch?.[1];
    if (!accessToken || accessToken.length > 16_384) {
        res.status(401).json({ error: 'Microsoft sign-in is required.' });
        return;
    }

    try {
        const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (profileResponse.status === 401 || profileResponse.status === 403) {
            res.status(401).json({ error: 'Microsoft sign-in is invalid or expired.' });
            return;
        }
        if (!profileResponse.ok) {
            res.status(503).json({ error: 'Microsoft sign-in could not be verified right now.' });
            return;
        }

        const tokenParts = accessToken.split('.');
        const encodedClaims = tokenParts[1];
        if (tokenParts.length !== 3 || !encodedClaims || !/^[A-Za-z0-9_-]+$/.test(encodedClaims)) {
            res.status(401).json({ error: 'Microsoft sign-in is invalid.' });
            return;
        }

        // Graph has accepted the token above; read its tenant claim to enforce this app's tenant boundary.
        let claims: { tid?: unknown };
        try {
            const decodedClaims: unknown = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
            if (!decodedClaims || typeof decodedClaims !== 'object') {
                res.status(401).json({ error: 'Microsoft sign-in is invalid.' });
                return;
            }
            claims = decodedClaims as { tid?: unknown };
        } catch {
            res.status(401).json({ error: 'Microsoft sign-in is invalid.' });
            return;
        }
        if (typeof claims.tid !== 'string' || claims.tid.toLowerCase() !== MICROSOFT_TENANT_ID.toLowerCase()) {
            res.status(403).json({ error: 'This Microsoft account is not authorized.' });
            return;
        }

        const profile = await profileResponse.json() as {
            mail?: unknown;
            userPrincipalName?: unknown;
        };
        const accountEmails = [profile.mail, profile.userPrincipalName]
            .filter((email): email is string => typeof email === 'string')
            .map((email) => email.trim().toLowerCase());

        if (
            MICROSOFT_ALLOWED_EMAILS.size > 0 &&
            !accountEmails.some((email) => MICROSOFT_ALLOWED_EMAILS.has(email))
        ) {
            res.status(403).json({ error: 'This Microsoft account is not authorized.' });
            return;
        }

        next();
    } catch {
        res.status(503).json({ error: 'Microsoft sign-in could not be verified right now.' });
    }
};

// Keep the Python AI service private; authenticated browser requests come through this API.
app.post('/api/chat', requireMicrosoftAuth, async (req, res) => {
    const accessToken = req.header('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!accessToken && !DEVELOPER_MODE) {
        res.status(401).json({ error: 'Microsoft sign-in is required for Graph-connected chat.' });
        return;
    }

    const body = req.body as {
        message?: unknown;
        conversationHistory?: unknown;
    };
    const message = body?.message;
    const history = body?.conversationHistory;
    const validHistory =
        Array.isArray(history) &&
        history.length <= 20 &&
        history.every((item: unknown) =>
            typeof item === 'object' &&
            item !== null &&
            !Array.isArray(item) &&
            'role' in item &&
            (item.role === 'user' || item.role === 'assistant') &&
            'content' in item &&
            typeof item.content === 'string' &&
            item.content.trim().length > 0 &&
            item.content.length <= 4_000,
        );

    if (
        typeof message !== 'string' ||
        message.trim().length === 0 ||
        message.length > 4_000 ||
        !validHistory
    ) {
        res.status(400).json({ error: 'Chat message or history is invalid.' });
        return;
    }

    try {
        const result = await runPython(
            ['--request'],
            {
                message: message.trim(),
                conversationHistory: history,
                ...(accessToken ? { accessToken } : {}),
            },
            300_000,
        );
        if (typeof result.answer !== 'string' || !result.answer.trim()) {
            throw new Error('Python AI returned an invalid answer.');
        }

        const pendingActions: Array<{ id: string; summary: string }> = [];
        if (result.pendingActions !== undefined) {
            if (!Array.isArray(result.pendingActions) || !accessToken) {
                throw new Error('Python AI returned invalid pending actions.');
            }
            for (const action of result.pendingActions) {
                if (
                    !action ||
                    typeof action !== 'object' ||
                    !('name' in action) ||
                    typeof action.name !== 'string' ||
                    !CHAT_WRITE_TOOL_NAMES.has(action.name) ||
                    !('arguments' in action) ||
                    !action.arguments ||
                    typeof action.arguments !== 'object' ||
                    Array.isArray(action.arguments) ||
                    JSON.stringify(action.arguments).length > 32_000 ||
                    !('summary' in action) ||
                    typeof action.summary !== 'string' ||
                    !action.summary.trim() ||
                    action.summary.length > 16_000
                ) {
                    throw new Error('Python AI returned an invalid pending action.');
                }

                const id = crypto.randomBytes(32).toString('hex');
                const expiresAt = Date.now() + CHAT_ACTION_TTL_MS;
                pendingChatActions.set(id, {
                    name: action.name,
                    arguments: action.arguments as Record<string, unknown>,
                    summary: action.summary,
                    accessTokenHash: crypto.createHash('sha256').update(accessToken).digest(),
                    expiresAt,
                });
                const expiryTimer = setTimeout(
                    () => pendingChatActions.delete(id),
                    CHAT_ACTION_TTL_MS,
                );
                expiryTimer.unref();
                pendingActions.push({ id, summary: action.summary });
            }
        }
        res.json({ answer: result.answer, pendingActions });
    } catch (error) {
        console.error('AI chat service request failed:', error);
        res.status(503).json({
            error: 'The AI service could not answer this message. Check the backend terminal.',
        });
    }
});

app.post('/api/chat/actions/:actionId/approve', requireMicrosoftAuth, async (req, res) => {
    const accessToken = req.header('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!accessToken) {
        res.status(401).json({ error: 'Microsoft sign-in is required.' });
        return;
    }

    const actionId = req.params.actionId;
    if (typeof actionId !== 'string') {
        res.status(400).json({ error: 'The action request ID is invalid.' });
        return;
    }
    const pending = pendingChatActions.get(actionId);
    if (!pending || pending.expiresAt <= Date.now()) {
        pendingChatActions.delete(actionId);
        res.status(404).json({ error: 'This action request expired or was already used.' });
        return;
    }
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest();
    if (!crypto.timingSafeEqual(pending.accessTokenHash, accessTokenHash)) {
        res.status(403).json({ error: 'This action request belongs to a different sign-in session.' });
        return;
    }

    pendingChatActions.delete(actionId);
    try {
        const result = await runPython(
            ['--execute-tool'],
            {
                name: pending.name,
                arguments: pending.arguments,
                accessToken,
            },
            60_000,
        );
        res.json({ success: true, result: result.result ?? null });
    } catch (error) {
        console.error('Approved Microsoft Graph action failed:', error);
        res.status(502).json({
            error: 'Microsoft Graph could not complete the approved action. Check the backend terminal.',
        });
    }
});

app.post('/api/chat/actions/:actionId/dismiss', requireMicrosoftAuth, (req, res) => {
    const accessToken = req.header('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!accessToken) {
        res.status(401).json({ error: 'Microsoft sign-in is required.' });
        return;
    }

    const actionId = req.params.actionId;
    if (typeof actionId !== 'string') {
        res.status(400).json({ error: 'The action request ID is invalid.' });
        return;
    }
    const pending = pendingChatActions.get(actionId);
    if (!pending || pending.expiresAt <= Date.now()) {
        pendingChatActions.delete(actionId);
        res.status(404).json({ error: 'This action request expired or was already used.' });
        return;
    }
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest();
    if (!crypto.timingSafeEqual(pending.accessTokenHash, accessTokenHash)) {
        res.status(403).json({ error: 'This action request belongs to a different sign-in session.' });
        return;
    }

    pendingChatActions.delete(actionId);
    res.status(204).end();
});

// Verify whether a signed-in Microsoft account meets the configured tenant and email allowlist.
app.get('/api/microsoft/authorization', requireMicrosoftAuth, (_req, res) => {
    res.json({ authorized: true });
});

type EmailRequestBody = {
    to: string;
    cc?: string;
    subject: string;
    body: string;
};

const parseEmailRequestBody = (value: unknown): EmailRequestBody | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    const body = value as Record<string, unknown>;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (
        typeof body.to !== 'string' ||
        !emailPattern.test(body.to.trim()) ||
        typeof body.subject !== 'string' ||
        typeof body.body !== 'string' ||
        (body.cc !== undefined &&
            (typeof body.cc !== 'string' || (body.cc.trim() !== '' && !emailPattern.test(body.cc.trim()))))
    ) {
        return undefined;
    }

    return {
        to: body.to.trim(),
        ...(typeof body.cc === 'string' && body.cc.trim() ? { cc: body.cc.trim() } : {}),
        subject: body.subject,
        body: body.body,
    };
};

const microsoftGraphEmailRequest = async (
    req: express.Request,
    res: express.Response,
    method: 'GET' | 'POST',
    endpoint: string,
    body?: unknown,
): Promise<void> => {
    const accessToken = req.header('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!accessToken) {
        if (DEVELOPER_MODE) {
            res.status(503).json({
                error: 'Microsoft Graph actions require a Microsoft access token; OAuth is disabled in developer mode.',
            });
            return;
        }
        res.status(401).json({ error: 'Microsoft sign-in is required.' });
        return;
    }

    try {
        const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
            method,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                res.status(403).json({ error: 'Microsoft Graph denied this email action.' });
                return;
            }
            if (response.status === 404) {
                res.status(404).json({ error: 'The requested email was not found.' });
                return;
            }
            res.status(502).json({ error: 'Microsoft Graph could not complete the email request.' });
            return;
        }

        if (response.status === 204 || response.status === 202) {
            res.status(response.status).end();
            return;
        }

        const result: unknown = await response.json();
        res.status(response.status).json(result);
    } catch {
        console.error('Microsoft Graph email request failed.');
        res.status(502).json({ error: 'Microsoft Graph email request failed.' });
    }
};

app.get('/api/microsoft/emails/:messageId', requireMicrosoftAuth, (req, res) => {
    const messageId = req.params.messageId;
    if (typeof messageId !== 'string' || !messageId.trim()) {
        res.status(400).json({ error: 'A message ID is required.' });
        return;
    }

    void microsoftGraphEmailRequest(
        req,
        res,
        'GET',
        `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,receivedDateTime,body`,
    );
});

app.post('/api/microsoft/emails/drafts', requireMicrosoftAuth, (req, res) => {
    const email = parseEmailRequestBody(req.body);
    if (!email) {
        res.status(400).json({ error: 'A valid recipient, subject, and message body are required.' });
        return;
    }

    const message = {
        subject: email.subject,
        body: { contentType: 'Text', content: email.body },
        toRecipients: [{ emailAddress: { address: email.to } }],
        ccRecipients: email.cc ? [{ emailAddress: { address: email.cc } }] : [],
    };
    void microsoftGraphEmailRequest(req, res, 'POST', '/me/messages', message);
});

app.post('/api/microsoft/emails/send', requireMicrosoftAuth, (req, res) => {
    const email = parseEmailRequestBody(req.body);
    if (!email) {
        res.status(400).json({ error: 'A valid recipient, subject, and message body are required.' });
        return;
    }

    const message = {
        subject: email.subject,
        body: { contentType: 'Text', content: email.body },
        toRecipients: [{ emailAddress: { address: email.to } }],
        ccRecipients: email.cc ? [{ emailAddress: { address: email.cc } }] : [],
    };
    void microsoftGraphEmailRequest(req, res, 'POST', '/me/sendMail', {
        message,
        saveToSentItems: true,
    });
});

// ---------------------------------------------
// Calendar and email service proxy
// ---------------------------------------------
// Forward browser requests to the configured service while keeping its API key on this server.
// On success, relay parsed JSON; on failure, return a generic response to avoid exposing upstream diagnostics.
const internRequest = async (path: string, query: Record<string, string | undefined>, res: express.Response): Promise<void> => {
    if (!INTERN_KEY) {
        res.status(503).json({ error: 'Intern API is not configured.' });
        return;
    }

    // Pseudocode: start with the configured service URL, then append each present query parameter.
    const url = new URL(path, INTERN_BASE_URL);
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
            url.searchParams.set(key, value);
        }
    });

    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${INTERN_KEY}` },
        });
        // Do not relay the upstream error body; it may contain diagnostics or sensitive details.
        if (!response.ok) {
            res.status(502).json({ error: 'The requested service could not complete the request.' });
            return;
        }

        const body = await response.text();
        let data: unknown;
        try {
            data = JSON.parse(body);
        } catch {
            // Convert invalid upstream JSON into a predictable API error.
            data = { error: 'Intern API returned an invalid response.' };
        }
        res.status(response.status).json(data);
    } catch {
        console.error('Intern API request failed.');
        res.status(502).json({ error: 'Intern API request failed.' });
    }
};

// Return today's calendar events, optionally scoped to the requested timezone.
// The browser supplies the timezone as a query parameter; the proxy adds the private service credential.
app.get('/api/intern/calendar/today', requireMicrosoftAuth, (req, res) => {
    void internRequest('/intern/calendar/today', {
        timezone: typeof req.query.timezone === 'string' ? req.query.timezone : undefined,
    }, res);
});

// Return events in a requested time range, preserving paging and result-limit options.
// Only string-valued query parameters are forwarded, avoiding unexpected array/object values from Express.
app.get('/api/intern/calendar/events', requireMicrosoftAuth, (req, res) => {
    void internRequest('/intern/calendar/events', {
        timeMin: typeof req.query.timeMin === 'string' ? req.query.timeMin : undefined,
        timeMax: typeof req.query.timeMax === 'string' ? req.query.timeMax : undefined,
        maxResults: typeof req.query.maxResults === 'string' ? req.query.maxResults : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    }, res);
});

// Search messages using only query parameters that were provided as strings.
// Search filters and paging options pass through to the upstream email service.
app.get('/api/intern/emails/search', requireMicrosoftAuth, (req, res) => {
    void internRequest('/intern/emails/search', {
        text: typeof req.query.text === 'string' ? req.query.text : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        subject: typeof req.query.subject === 'string' ? req.query.subject : undefined,
        after: typeof req.query.after === 'string' ? req.query.after : undefined,
        before: typeof req.query.before === 'string' ? req.query.before : undefined,
        unreadOnly: typeof req.query.unreadOnly === 'string' ? req.query.unreadOnly : undefined,
        maxResults: typeof req.query.maxResults === 'string' ? req.query.maxResults : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    }, res);
});

// Retrieve one message; encode its ID so it remains a single URL path segment.
// The shared proxy handles credential injection, upstream response parsing, and safe errors.
app.get('/api/intern/emails/:messageId', requireMicrosoftAuth, (req, res) => {
    const messageId = req.params.messageId;
    if (typeof messageId !== 'string') {
        res.status(400).json({ error: 'A message ID is required.' });
        return;
    }
    void internRequest(`/intern/emails/${encodeURIComponent(messageId)}`, {}, res);
});

// ---------------------------------------------
// Google OAuth token exchange
// ---------------------------------------------
// Trade the browser's one-time authorization code and PKCE verifier for Google tokens.
// The client secret stays server-side; failed exchanges return a generic error to the browser.
app.post('/api/token', async (req, res) => {
    const { code, code_verifier, redirect_uri } = req.body;

    if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    try {
        // Pseudocode: send form-encoded OAuth fields to Google, including the server-held secret.
        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
                redirect_uri,
                code_verifier,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(502).json({ error: 'Token exchange failed. Please try again.' });
        }

        res.json(data);
    } catch {
        console.error('Token exchange failed.');
        res.status(500).json({ error: 'Token exchange failed.' });
    }
});

// ---------------------------------------------
// Server startup
// ---------------------------------------------
// Listen on port 5500, the backend API origin used by the browser application.
app.listen(5500, 'localhost', () => {
    console.log('Auth server running on http://localhost:5500');
    if (DEVELOPER_MODE) {
        console.warn('Developer mode is enabled; Microsoft authentication and authorization checks are bypassed.');
    }
});