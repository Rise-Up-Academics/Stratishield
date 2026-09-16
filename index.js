"use strict";

// The landing page is protected by the token stored during the OAuth callback.
const accessToken = sessionStorage.getItem('oauth_access_token');
const appContent = document.getElementById('appContent');
const authRequired = document.getElementById('authRequired');
const userEmail = document.getElementById('userEmail');
const logoutButton = document.getElementById('logoutButton');

const redirectToLogin = () => {
    window.location.assign('auth.html');
};

const clearSession = () => {
    sessionStorage.removeItem('oauth_access_token');
    sessionStorage.removeItem('oauth_user_profile');
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('oauth_code_verifier');
};

const showUnauthenticatedState = () => {
    if (appContent) {
        appContent.hidden = true;
    }
    if (authRequired) {
        authRequired.hidden = false;
    }
};

const showAuthenticatedState = (profile) => {
    if (userEmail) {
        userEmail.textContent = profile.email ?? 'Authenticated user';
    }
    if (appContent) {
        appContent.hidden = false;
    }
    if (authRequired) {
        authRequired.hidden = true;
    }
};

if (!accessToken) {
    showUnauthenticatedState();
} else {
    const storedProfile = sessionStorage.getItem('oauth_user_profile');

    if (storedProfile) {
        try {
            showAuthenticatedState(JSON.parse(storedProfile));
        } catch {
            sessionStorage.removeItem('oauth_user_profile');
            redirectToLogin();
        }
    } else {
        fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Session expired.');
                }
                return response.json();
            })
            .then((profile) => {
                sessionStorage.setItem('oauth_user_profile', JSON.stringify(profile));
                showAuthenticatedState(profile);
            })
            .catch(() => {
                clearSession();
                redirectToLogin();
            });
    }
}

logoutButton?.addEventListener('click', () => {
    clearSession();
    redirectToLogin();
});
