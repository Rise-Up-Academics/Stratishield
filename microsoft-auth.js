"use strict";

const AUTH_SERVER_ORIGIN = "http://localhost:5500";
const AUTH_SERVER_CONFIG = `${AUTH_SERVER_ORIGIN}/api/microsoft-config`;
const DEVICE_SCOPE = "openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite";
const signInButton = document.getElementById("signInButton");
const developerModeButton = document.getElementById("developerModeButton");
const status = document.getElementById("status");

const setStatus = (message) => {
    status.textContent = message;
};

const toBase64Url = (bytes) => {
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const createVerifier = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
};

const createChallenge = async (verifier) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return toBase64Url(new Uint8Array(digest));
};

const getConfig = async () => {
    const response = await fetch(AUTH_SERVER_CONFIG);
    if (!response.ok) {
        throw new Error("Microsoft sign-in is not configured.");
    }
    return response.json();
};

const startMicrosoftSignIn = async () => {
    const config = await getConfig();
    const state = createVerifier();
    const verifier = createVerifier();
    const challenge = await createChallenge(verifier);
    const redirectUri = `${window.location.origin}${window.location.pathname}`;

    sessionStorage.setItem("microsoft_oauth_state", state);
    sessionStorage.setItem("microsoft_oauth_verifier", verifier);

    const authorizationUrl = new URL(
        `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`
    );
    authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: DEVICE_SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...(sessionStorage.getItem("microsoft_auth_return_to") ? { prompt: "select_account" } : {}),
    }).toString();

    window.location.assign(authorizationUrl.href);
};

const completeMicrosoftSignIn = async () => {
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState({}, document.title, window.location.pathname);
    const error = params.get("error");
    if (error) {
        throw new Error("Microsoft sign-in was not completed. Please try again.");
    }

    const code = params.get("code");
    if (!code) {
        return;
    }

    const savedState = sessionStorage.getItem("microsoft_oauth_state");
    if (!savedState || savedState !== params.get("state")) {
        throw new Error("Invalid OAuth state. Start Microsoft sign-in again.");
    }

    const verifier = sessionStorage.getItem("microsoft_oauth_verifier");
    if (!verifier) {
        throw new Error("Missing PKCE verifier. Start Microsoft sign-in again.");
    }

    const config = await getConfig();
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const response = await fetch(
        `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: config.clientId,
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                code_verifier: verifier,
                scope: DEVICE_SCOPE,
            }),
        }
    );
    const data = await response.json();
    if (!response.ok) {
        throw new Error("Microsoft sign-in could not be completed. Please try again.");
    }

    sessionStorage.removeItem("microsoft_oauth_state");
    sessionStorage.removeItem("microsoft_oauth_verifier");
    sessionStorage.setItem("microsoft_access_token", data.access_token);

    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) {
        throw new Error("Microsoft profile could not be loaded. Please try again.");
    }

    sessionStorage.setItem("oauth_provider", "microsoft");
    sessionStorage.setItem("oauth_access_token", data.access_token);
    sessionStorage.setItem("oauth_user_profile", JSON.stringify(profile));
    const returnTo = sessionStorage.getItem("microsoft_auth_return_to");
    sessionStorage.removeItem("microsoft_auth_return_to");
    window.location.assign(returnTo === "/email.html" ? returnTo : "/index.html");

    setStatus("Microsoft authorization completed.");
};

const initializeMicrosoftAuthPage = async () => {
    let developerMode = false;
    try {
        developerMode = await window.inboxOSDeveloperMode.isEnabled();
    } catch (error) {
        console.error("Unable to load application configuration.", error);
        setStatus("Developer mode could not be checked; normal Microsoft sign-in remains available.");
    }

    if (developerMode) {
        signInButton.hidden = true;
        if (!developerModeButton) {
            const returnTo = sessionStorage.getItem("microsoft_auth_return_to");
            sessionStorage.removeItem("microsoft_auth_return_to");
            window.location.assign(returnTo === "/email.html" ? returnTo : "/index.html");
            return;
        }
        developerModeButton.hidden = false;
        developerModeButton.addEventListener("click", () => {
            const returnTo = sessionStorage.getItem("microsoft_auth_return_to");
            sessionStorage.removeItem("microsoft_auth_return_to");
            window.location.assign(returnTo === "/email.html" ? returnTo : "/index.html");
        });
        return;
    }

    signInButton.hidden = false;
    signInButton.addEventListener("click", () => {
        setStatus("Preparing Microsoft sign-in...");
        void startMicrosoftSignIn().catch(() => {
            setStatus("Microsoft sign-in could not be started. Please try again.");
        });
    });

    void completeMicrosoftSignIn().catch(() => {
        setStatus("Microsoft sign-in could not be completed. Please try again.");
    });
};

void initializeMicrosoftAuthPage();
