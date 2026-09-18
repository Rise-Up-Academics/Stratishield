"use strict";

// The landing page is protected by the token stored during the OAuth callback.
const accessToken = sessionStorage.getItem('oauth_access_token');
const appContent = document.getElementById('appContent');
const authRequired = document.getElementById('authRequired');
const protectedSite = document.getElementById("protectedSite") as HTMLElement || null;
const authFallback = document.getElementById("authFallback") as HTMLElement || null;
const userEmail = document.getElementById("userEmail");
const logoutButton = document.getElementById("logoutButton");

const redirectToAuth = () => {
    window.location.replace("/auth.html");
};

const clearSession = () => {
    sessionStorage.removeItem("oauth_access_token");
    sessionStorage.removeItem("oauth_user_profile");
    sessionStorage.removeItem("oauth_state");
    sessionStorage.removeItem("oauth_code_verifier");
};

const showProtectedSite = (profile: {email: string}) => {
    protectedSite.hidden = false;
    authFallback.hidden = true;

    if (userEmail) {
        userEmail.textContent = profile.email || "Authenticated user";
    }
};

const showUnauthenticatedState = () => {
    if (appContent) {
        appContent.hidden = true;
    }
    if (authRequired) {
        authRequired.hidden = false;
    }
};

const showAuthenticatedState = (profile: {email: string}) => {
    if (userEmail) {
        userEmail.textContent = profile.email = 'Authenticated user';
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
            redirectToAuth();
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
                redirectToAuth();
            });
    }
}

const verifyAuthentication = async () => {
    const accessToken = sessionStorage.getItem("oauth_access_token");

    if (!accessToken) {
        redirectToAuth();
        return;
    }

    try {
        const response = await fetch(
            "https://openidconnect.googleapis.com/v1/userinfo",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok) {
            throw new Error("Authentication expired.");
        }

        const profile = await response.json();

        sessionStorage.setItem(
            "oauth_user_profile",
            JSON.stringify(profile)
        );

        showProtectedSite(profile);
    } catch {
        clearSession();
        redirectToAuth();
    }
};

logoutButton?.addEventListener("click", () => {
    clearSession();
    redirectToAuth();
});

verifyAuthentication();
