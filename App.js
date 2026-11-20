"use strict";
// -----------------------------------------------------------------------------
// Shared types and configuration
// -----------------------------------------------------------------------------
// OAuth endpoints and client settings shared by the authentication functions.
const AUTH_SERVER_ORIGIN = 'http://localhost:5500';
const FRONTEND_ORIGIN = 'http://localhost:3000';
const CLIENT_ID = '423278388631-b9tk58lpag1ioq47uou0capsnvj898ii.apps.googleusercontent.com';
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const MICROSOFT_AUTH_CONFIG_ENDPOINT = `${AUTH_SERVER_ORIGIN}/api/microsoft-config`;
const MICROSOFT_SCOPE = 'openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite';
const MICROSOFT_AUTH_RETURN_TO_KEY = 'microsoft_auth_return_to';
const redirectUri = `${window.location.origin}/auth.html`;
// -----------------------------------------------------------------------------
// Authentication helpers
// -----------------------------------------------------------------------------
// Safely updates an element's text when that element exists on the current page.
const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
};
// Converts bytes into URL-safe Base64, used to create OAuth PKCE values.
const toBase64Url = (bytes) => {
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
// Generates a random PKCE verifier for this sign-in attempt.
const createCodeVerifier = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
};
// Hashes the verifier to create the challenge sent to the OAuth provider.
const createCodeChallenge = async (verifier) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return toBase64Url(new Uint8Array(digest));
};
// -----------------------------------------------------------------------------
// Authentication page functionality
// -----------------------------------------------------------------------------
// Starts Google OAuth and saves state/verifier so the callback can be checked.
const startAuthorization = async (isRegistration) => {
    const state = createCodeVerifier();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = await createCodeChallenge(codeVerifier);
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_code_verifier', codeVerifier);
    const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
    authorizationUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ...(isRegistration ? { prompt: 'select_account' } : {}),
    }).toString();
    window.location.assign(authorizationUrl.href);
};
// Sends Microsoft sign-in to its dedicated authentication page.
const startMicrosoftAuthorization = () => {
    window.location.assign(`${AUTH_SERVER_ORIGIN}/microsoft-auth.html`);
};
const getMicrosoftConfig = async () => {
    const response = await fetch(MICROSOFT_AUTH_CONFIG_ENDPOINT);
    const data = await response.json();
    if (!response.ok) {
        const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Microsoft OAuth is not configured.';
        throw new Error(message);
    }
    if (!data ||
        typeof data !== 'object' ||
        !('clientId' in data) ||
        typeof data.clientId !== 'string' ||
        !('tenantId' in data) ||
        typeof data.tenantId !== 'string') {
        throw new Error('Microsoft OAuth configuration is invalid.');
    }
    return { clientId: data.clientId, tenantId: data.tenantId };
};
const startMicrosoftSignIn = async () => {
    const config = await getMicrosoftConfig();
    const state = createCodeVerifier();
    const verifier = createCodeVerifier();
    const challenge = await createCodeChallenge(verifier);
    const microsoftRedirectUri = `${window.location.origin}${window.location.pathname}`;
    sessionStorage.setItem('microsoft_oauth_state', state);
    sessionStorage.setItem('microsoft_oauth_verifier', verifier);
    const authorizationUrl = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
    authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: microsoftRedirectUri,
        response_mode: 'query',
        scope: MICROSOFT_SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...(sessionStorage.getItem(MICROSOFT_AUTH_RETURN_TO_KEY) ? { prompt: 'select_account' } : {}),
    }).toString();
    window.location.assign(authorizationUrl.href);
};
const completeMicrosoftSignIn = async () => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const code = params.get('code');
    if (!error && !code) {
        return;
    }
    window.history.replaceState({}, document.title, window.location.pathname);
    if (error) {
        throw new Error(`Microsoft sign-in failed: ${params.get('error_description') || error}`);
    }
    if (!code) {
        return;
    }
    const savedState = sessionStorage.getItem('microsoft_oauth_state');
    if (!savedState || savedState !== params.get('state')) {
        throw new Error('Invalid OAuth state. Start Microsoft sign-in again.');
    }
    const verifier = sessionStorage.getItem('microsoft_oauth_verifier');
    if (!verifier) {
        throw new Error('Missing PKCE verifier. Start Microsoft sign-in again.');
    }
    const config = await getMicrosoftConfig();
    const microsoftRedirectUri = `${window.location.origin}${window.location.pathname}`;
    const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.clientId,
            grant_type: 'authorization_code',
            code,
            redirect_uri: microsoftRedirectUri,
            code_verifier: verifier,
            scope: MICROSOFT_SCOPE,
        }),
    });
    const data = await response.json();
    if (!response.ok || typeof data.access_token !== 'string') {
        throw new Error(data.error_description || 'Microsoft token exchange failed.');
    }
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) {
        throw new Error('Microsoft profile request failed.');
    }
    sessionStorage.removeItem('microsoft_oauth_state');
    sessionStorage.removeItem('microsoft_oauth_verifier');
    const handoffResponse = await fetch(`${AUTH_SERVER_ORIGIN}/api/microsoft/session-handoffs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.access_token, profile }),
    });
    const handoffData = await handoffResponse.json();
    if (!handoffResponse.ok || typeof handoffData.handoffId !== 'string') {
        throw new Error('Microsoft sign-in could not be completed. Please try again.');
    }

    const returnTo = sessionStorage.getItem(MICROSOFT_AUTH_RETURN_TO_KEY);
    sessionStorage.removeItem(MICROSOFT_AUTH_RETURN_TO_KEY);
    const redirectUrl = new URL(`${FRONTEND_ORIGIN}/index.html`);
    redirectUrl.searchParams.set('microsoftHandoff', handoffData.handoffId);
    if (returnTo === '/email.html') {
        redirectUrl.searchParams.set('returnTo', returnTo);
    }
    window.location.assign(redirectUrl.href);
};
const initializeMicrosoftAuthPage = async () => {
    const signInButton = document.getElementById('signInButton');
    if (!signInButton) {
        return;
    }
    if (new URLSearchParams(window.location.search).get('returnTo') === '/email.html') {
        sessionStorage.setItem(MICROSOFT_AUTH_RETURN_TO_KEY, '/email.html');
    }
    const status = document.getElementById('status');
    const setMicrosoftStatus = (message) => {
        if (status) {
            status.textContent = message;
        }
    };
    const developerModeButton = document.getElementById('developerModeButton');
    let developerMode = false;
    try {
        developerMode = await window.inboxOSDeveloperMode.isEnabled();
    }
    catch (error) {
        console.error('Unable to load application configuration.', error);
        setMicrosoftStatus('Developer mode could not be checked; normal Microsoft sign-in remains available.');
    }
    if (developerMode) {
        signInButton.hidden = true;
        if (!developerModeButton) {
            const returnTo = sessionStorage.getItem(MICROSOFT_AUTH_RETURN_TO_KEY);
            sessionStorage.removeItem(MICROSOFT_AUTH_RETURN_TO_KEY);
            window.location.assign(`${FRONTEND_ORIGIN}${returnTo === '/email.html' ? returnTo : '/index.html'}`);
            return;
        }
        developerModeButton.hidden = false;
        developerModeButton.addEventListener('click', () => {
            const returnTo = sessionStorage.getItem(MICROSOFT_AUTH_RETURN_TO_KEY);
            sessionStorage.removeItem(MICROSOFT_AUTH_RETURN_TO_KEY);
            window.location.assign(`${FRONTEND_ORIGIN}${returnTo === '/email.html' ? returnTo : '/index.html'}`);
        });
        return;
    }
    signInButton.hidden = false;
    signInButton.addEventListener('click', () => {
        setMicrosoftStatus('Preparing Microsoft sign-in...');
        void startMicrosoftSignIn().catch((error) => {
            setMicrosoftStatus(error instanceof Error ? error.message : 'Microsoft sign-in could not be started.');
        });
    });
    void completeMicrosoftSignIn().catch((error) => {
        setMicrosoftStatus(error instanceof Error ? error.message : 'Microsoft sign-in could not be completed.');
    });
};
// Exchanges Google's authorization code and saved PKCE verifier for a token.
const exchangeCodeForToken = async (code) => {
    const codeVerifier = sessionStorage.getItem('oauth_code_verifier');
    if (!codeVerifier) {
        throw new Error('Missing PKCE code verifier. Start login again.');
    }
    const response = await fetch(`${AUTH_SERVER_ORIGIN}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
        }),
    });
    if (!response.ok) {
        throw new Error('Token exchange failed. Please try again.');
    }
    return response.json();
};
// Uses the access token to retrieve the signed-in user's Google profile.
const getUserProfile = async (accessToken) => {
    const response = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        throw new Error(`User profile request failed (${response.status}).`);
    }
    return response.json();
};
// Displays one authentication or error section and hides the others.
const showAuthPage = (page) => {
    ['registerPage', 'loginPage', 'profilePage', 'errorPage'].forEach((id) => {
        const section = document.getElementById(id);
        if (section) {
            section.hidden = section !== page;
        }
    });
};
// Switches between registration and login while hiding profile/error sections.
const showAuthenticationPages = (page) => {
    const registerPage = document.getElementById('registerPage');
    const loginPage = document.getElementById('loginPage');
    if (registerPage)
        registerPage.hidden = page !== registerPage;
    if (loginPage)
        loginPage.hidden = page !== loginPage;
    const profilePage = document.getElementById('profilePage');
    const errorPage = document.getElementById('errorPage');
    if (profilePage)
        profilePage.hidden = true;
    if (errorPage)
        errorPage.hidden = true;
};
// Offers only Microsoft sign-in and discards sessions created by another provider.
const initializeAuthPage = async () => {
    const signInButton = document.getElementById('microsoftSignInButton');
    if (!signInButton) {
        return;
    }
    const developerModeButton = document.getElementById('developerModeButton');
    let developerMode = false;
    try {
        developerMode = await window.inboxOSDeveloperMode.isEnabled();
    }
    catch (error) {
        console.error('Unable to load application configuration.', error);
    }
    if (developerMode) {
        signInButton.hidden = true;
        if (!developerModeButton) {
            window.location.assign('/index.html');
            return;
        }
        developerModeButton.hidden = false;
        developerModeButton.addEventListener('click', () => {
            window.location.assign('/index.html');
        });
        return;
    }
    if (developerModeButton) {
        developerModeButton.hidden = true;
    }
    signInButton.hidden = false;
    if (sessionStorage.getItem('oauth_provider') === 'microsoft' &&
        sessionStorage.getItem('oauth_access_token')) {
        window.location.assign('/index.html');
        return;
    }
    clearSession();
    signInButton.addEventListener('click', startMicrosoftAuthorization);
};
//------------------------------------------------------------------------------
// User Profile functionality
//------------------------------------------------------------------------------
// Create a random uuid for user identification when the User Creates an account, or logs in and doesn't already have one. This is used to identify the user in the database and for other purposes.
const generateUUID = () => {
    const cryptoObj = window.crypto || window.msCrypto;
    const array = new Uint8Array(16);
    cryptoObj.getRandomValues(array);
    const hex = Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
// Save UUID to session storage if it doesn't exist
const saveUUIDToSessionStorage = () => {
    if (!sessionStorage.getItem('user_uuid')) {
        const uuid = generateUUID();
        sessionStorage.setItem('user_uuid', uuid);
    }
};
// -----------------------------------------------------------------------------
// Protected index page functionality
// -----------------------------------------------------------------------------
// Removes saved authentication data when the user logs out or a token is invalid.
const clearSession = () => {
    sessionStorage.removeItem('oauth_access_token');
    sessionStorage.removeItem('oauth_provider');
    sessionStorage.removeItem('oauth_user_profile');
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('oauth_code_verifier');
};
// Returns unauthenticated users to the sign-in page.
const redirectToAuth = () => {
    if (window.inboxOSDeveloperMode.isBypassActive()) {
        return;
    }
    window.location.replace('/auth.html');
};
// Reveals protected content and displays the signed-in user's email.
const showProtectedSite = (profile) => {
    const protectedSite = document.getElementById('protectedSite');
    const authRequired = document.getElementById('authRequired');
    if (!protectedSite || !authRequired) {
        return;
    }
    protectedSite.hidden = false;
    authRequired.hidden = true;
    const userEmail = document.getElementById('userEmail');
    if (userEmail) {
        userEmail.textContent = profile.email || profile.userPrincipalName || 'Authenticated user';
    }
};
const consumeMicrosoftSessionHandoff = async () => {
    const params = new URLSearchParams(window.location.search);
    const handoffId = params.get('microsoftHandoff');
    if (!handoffId) {
        return false;
    }
    const response = await fetch(`${AUTH_SERVER_ORIGIN}/api/microsoft/session-handoffs/${encodeURIComponent(handoffId)}/consume`, { method: 'POST' });
    if (!response.ok) {
        throw new Error('Microsoft sign-in handoff expired. Please sign in again.');
    }
    const data = await response.json();
    if (typeof data.accessToken !== 'string' ||
        typeof data.profile !== 'object' ||
        data.profile === null ||
        Array.isArray(data.profile)) {
        throw new Error('Microsoft sign-in handoff is invalid.');
    }
    sessionStorage.setItem('oauth_provider', 'microsoft');
    sessionStorage.setItem('oauth_access_token', data.accessToken);
    sessionStorage.setItem('oauth_user_profile', JSON.stringify(data.profile));
    window.history.replaceState({}, document.title, window.location.pathname);
    if (params.get('returnTo') === '/email.html') {
        window.location.replace(`${FRONTEND_ORIGIN}/email.html`);
    }
    return true;
};
// Checks the saved token with its provider before showing protected content.
const verifyAuthentication = async () => {
    const accessToken = sessionStorage.getItem('oauth_access_token');
    const provider = sessionStorage.getItem('oauth_provider');
    if (!accessToken || provider !== 'microsoft') {
        clearSession();
        redirectToAuth();
        return;
    }
    try {
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) {
            throw new Error('Authentication expired.');
        }
        const profile = await response.json();
        sessionStorage.setItem('oauth_user_profile', JSON.stringify(profile));
        showProtectedSite(profile);
    }
    catch {
        clearSession();
        redirectToAuth();
    }
};
// Connects index-page controls and starts the token check.
// It exits on other pages because their index-specific elements are absent.
const initializeIndexPage = async () => {
    const authRequired = document.getElementById('authRequired');
    const protectedSite = document.getElementById('protectedSite');
    // The index page's elements are absent on the auth page.
    if (!authRequired || !protectedSite) {
        return;
    }
    // Clear the session and sign out when the logout control is clicked.
    document.getElementById('logoutButton')?.addEventListener('click', () => {
        clearSession();
        redirectToAuth();
    });
    // Toggle the profile menu and keep its accessibility state in sync.
    const profileBtn = document.getElementById('profileBtn');
    const profileMenu = document.getElementById('profileMenu');
    const profileBar = document.getElementById('profileBar');
    const closeProfileMenu = () => {
        if (!profileBar)
            return;
        profileBar.hidden = true;
        profileBtn?.setAttribute('aria-expanded', 'false');
    };
    profileBtn?.addEventListener('click', () => {
        if (!profileBar)
            return;
        const isOpen = !profileBar.hidden;
        profileBar.hidden = isOpen;
        profileBtn.setAttribute('aria-expanded', String(!isOpen));
    });
    // Close the menu when the user clicks outside it.
    document.addEventListener('click', (event) => {
        if (!profileBar || !profileMenu || profileBar.hidden)
            return;
        if (!profileMenu.contains(event.target)) {
            closeProfileMenu();
        }
    });
    // Allow keyboard users to close the menu with Escape.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && profileBar && !profileBar.hidden) {
            closeProfileMenu();
            profileBtn?.focus();
        }
    });
    try {
        if (await consumeMicrosoftSessionHandoff()) {
            return;
        }
        if (await window.inboxOSDeveloperMode.revealProtectedPages()) {
            showProtectedSite({ email: 'Developer mode (OAuth disabled)' });
            return;
        }
    }
    catch (error) {
        console.error('Unable to load application configuration.', error);
    }
    await verifyAuthentication();
};
// -----------------------------------------------------------------------------
//  Page Functionallity
// -----------------------------------------------------------------------------
const showMenuBar = () => {
    const menuButton = document.getElementById('menuButton');
    const menuBar = document.getElementById('menuTab');
    if (!menuButton || !menuBar)
        return;
    // Place the button above the menu so it remains clickable while the menu is open.
    menuButton.style.position = 'relative';
    menuButton.style.zIndex = '1001';
    menuBar.style.position = 'relative';
    menuBar.style.zIndex = '1000';
    const setMenuOpen = (isOpen) => {
        menuBar.hidden = !isOpen;
        menuBar.style.display = isOpen ? 'block' : 'none';
        menuButton.setAttribute('aria-expanded', String(isOpen));
    };
    menuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        setMenuOpen(menuBar.hidden);
    });
    // Close the menu when clicking outside it or its toggle button.
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof Node &&
            !menuBar.contains(target) &&
            !menuButton.contains(target)) {
            setMenuOpen(false);
        }
    });
    // Allow keyboard users to close the menu with Escape.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            setMenuOpen(false);
        }
    });
    // Apply the initial visibility state from the HTML.
    setMenuOpen(!menuBar.hidden);
};
// -----------------------------------------------------------------------------
// Page initialization
// -----------------------------------------------------------------------------
// Both functions can run safely: each detects whether its page elements exist.
void initializeAuthPage();
void initializeMicrosoftAuthPage();
void initializeIndexPage();
showMenuBar();
