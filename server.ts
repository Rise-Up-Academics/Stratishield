import express = require('express');
import cors = require('cors');
import dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const INTERN_BASE_URL = process.env.INTERN_BASE_URL ?? 'https://chief-of-staff-aggregator.onrender.com';
const INTERN_KEY = process.env.INTERN_KEY;

const internRequest = async (path: string, query: Record<string, string | undefined>, res: express.Response): Promise<void> => {
    if (!INTERN_KEY) {
        res.status(503).json({ error: 'Intern API is not configured.' });
        return;
    }

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
        const body = await response.text();
        let data: unknown;
        try {
            data = JSON.parse(body);
        } catch {
            data = { error: 'Intern API returned an invalid response.' };
        }
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Intern API request failed:', error instanceof Error ? error.message : 'unknown error');
        res.status(502).json({ error: 'Intern API request failed.' });
    }
};

app.get('/api/intern/calendar/today', (req, res) => {
    void internRequest('/intern/calendar/today', {
        timezone: typeof req.query.timezone === 'string' ? req.query.timezone : undefined,
    }, res);
});

app.get('/api/intern/calendar/events', (req, res) => {
    void internRequest('/intern/calendar/events', {
        timeMin: typeof req.query.timeMin === 'string' ? req.query.timeMin : undefined,
        timeMax: typeof req.query.timeMax === 'string' ? req.query.timeMax : undefined,
        maxResults: typeof req.query.maxResults === 'string' ? req.query.maxResults : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    }, res);
});

app.get('/api/intern/emails/search', (req, res) => {
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

app.get('/api/intern/emails/:messageId', (req, res) => {
    void internRequest(`/intern/emails/${encodeURIComponent(req.params.messageId)}`, {}, res);
});

app.post('/api/token', async (req, res) => {
    const { code, code_verifier, redirect_uri } = req.body;

    if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    try {
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
            return res.status(response.status).json(data);
        }

        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Token exchange failed.' });
    }
});

app.listen(3000, () => console.log('Auth server running on http://localhost:3000'));