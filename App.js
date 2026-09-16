"use strict";
// Point this at your OAuth2/OIDC server. Do not use the same port as the static app server.
const AUTH_SERVER_ORIGIN = 'http://localhost:4000';
const CLIENT_ID = "423278388631-b9tk58lpag1ioq47uou0capsnvj898ii.apps.googleusercontent.com";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const registerPage = document.getElementById('registerPage');
const loginPage = document.getElementById('loginPage');
const profilePage = document.getElementById('profilePage');
const errorPage = document.getElementById('errorPage');
const redirectUri = `${window.location.origin}/auth.html`;
const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
};
const showPage = (page) => {
    [registerPage, loginPage, profilePage, errorPage].forEach((section) => {
        section.hidden = section !== page;
    });
};
const showAuthenticationPages = (page) => {
    registerPage.hidden = page !== registerPage;
    loginPage.hidden = page !== loginPage;
    profilePage.hidden = true;
    errorPage.hidden = true;
};
const toBase64Url = (bytes) => {
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const createCodeVerifier = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
};
const createCodeChallenge = async (verifier) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return toBase64Url(new Uint8Array(digest));
};
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
const exchangeCodeForToken = async (code) => {
    const codeVerifier = sessionStorage.getItem('oauth_code_verifier');
    if (!codeVerifier) {
        throw new Error('Missing PKCE code verifier. Start login again.');
    }
    const response = await fetch('http://localhost:3000/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
        }),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error('Token exchange error body:', errorBody);
        throw new Error(`Token exchange failed (${response.status}).`);
    }
    return response.json();
};
const getUserProfile = async (accessToken) => {
    const response = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        throw new Error(`User profile request failed (${response.status}).`);
    }
    return response.json();
};
(async () => {
    try {
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        const code = params.get('code');
        if (error) {
            setText('authError', `Authentication failed: ${params.get('error_description') ?? error}`);
            showPage(errorPage);
            return;
        }
        if (code) {
            const returnedState = params.get('state');
            const savedState = sessionStorage.getItem('oauth_state');
            if (!returnedState || returnedState !== savedState) {
                throw new Error('Invalid OAuth state. Start login again.');
            }
            const token = await exchangeCodeForToken(code);
            sessionStorage.setItem('oauth_access_token', token.access_token);
            sessionStorage.removeItem('oauth_state');
            sessionStorage.removeItem('oauth_code_verifier');
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        const accessToken = sessionStorage.getItem('oauth_access_token');
        if (accessToken) {
            const user = await getUserProfile(accessToken);
            setText('userEmail', user.email ?? 'Unknown user');
            setText('userProfile', JSON.stringify(user, null, 2));
            showPage(profilePage);
            document.getElementById('logoutButton')?.addEventListener('click', () => {
                sessionStorage.removeItem('oauth_access_token');
                window.location.reload();
            });
            return;
        }
        showAuthenticationPages(registerPage);
        document.getElementById('registerButton')?.addEventListener('click', () => void startAuthorization(true));
        document.getElementById('loginButton')?.addEventListener('click', () => void startAuthorization(false));
        document.getElementById('showLoginButton')?.addEventListener('click', () => showAuthenticationPages(loginPage));
        document.getElementById('showRegisterButton')?.addEventListener('click', () => showAuthenticationPages(registerPage));
    }
    catch (error) {
        setText('authError', error instanceof Error ? error.message : 'Authentication failed.');
        showPage(errorPage);
    }
})();
