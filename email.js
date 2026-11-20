"use strict";

const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com/v1.0";
const AUTH_SERVER_ORIGIN = "http://localhost:5500";
const emailProtected = document.getElementById("emailProtected");

const setStatus = (id, message) => {
    const status = document.getElementById(id);
    if (status) {
        status.textContent = message;
    }
};

const redirectToMicrosoftAuth = () => {
    if (window.inboxOSDeveloperMode.isBypassActive()) {
        return;
    }
    window.location.replace(`${AUTH_SERVER_ORIGIN}/microsoft-auth.html?returnTo=%2Femail.html`);
};

const clearMicrosoftSession = () => {
    sessionStorage.removeItem("oauth_access_token");
    sessionStorage.removeItem("oauth_provider");
    sessionStorage.removeItem("oauth_user_profile");
    sessionStorage.removeItem("microsoft_access_token");
};

const getAccessToken = () => sessionStorage.getItem("oauth_access_token");

const makeEmailApiRequest = async (endpoint, options = {}) => {
    const accessToken = getAccessToken();
    if (!accessToken) {
        if (await window.inboxOSDeveloperMode.isEnabled()) {
            throw new Error("Microsoft Graph actions require a Microsoft token; sign-in is disabled in developer mode.");
        }
        clearMicrosoftSession();
        redirectToMicrosoftAuth();
        throw new Error("Your Microsoft sign-in has expired. Please sign in again.");
    }

    const response = await fetch(`${AUTH_SERVER_ORIGIN}/api/microsoft/emails${endpoint}`, {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (response.status === 401) {
        if (await window.inboxOSDeveloperMode.isEnabled()) {
            throw new Error("Microsoft Graph actions require a valid Microsoft token.");
        }
        clearMicrosoftSession();
        redirectToMicrosoftAuth();
        throw new Error("Your Microsoft sign-in has expired. Please sign in again.");
    }
    if (response.status === 403) {
        throw new Error("This account is not authorized or lacks permission for that email action.");
    }
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error("No email was found with that message ID.");
        }
        throw new Error("The email request could not be completed.");
    }

    if (response.status === 204 || response.status === 202) {
        return null;
    }
    return response.json();
};

const makeGraphRequest = async (endpoint, options = {}) => {
    const accessToken = getAccessToken();
    if (!accessToken) {
        if (await window.inboxOSDeveloperMode.isEnabled()) {
            throw new Error("Microsoft Graph actions require a Microsoft token; sign-in is disabled in developer mode.");
        }
        clearMicrosoftSession();
        redirectToMicrosoftAuth();
        throw new Error("Your Microsoft sign-in has expired. Please sign in again.");
    }

    const response = await fetch(`${MICROSOFT_GRAPH_URL}${endpoint}`, {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (response.status === 401) {
        if (await window.inboxOSDeveloperMode.isEnabled()) {
            throw new Error("Microsoft Graph actions require a valid Microsoft token.");
        }
        clearMicrosoftSession();
        redirectToMicrosoftAuth();
        throw new Error("Your Microsoft sign-in has expired. Please sign in again.");
    }
    if (response.status === 403) {
        throw new Error("This account does not have permission to perform that email action.");
    }
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error("No email was found with that message ID.");
        }
        throw new Error("Microsoft Graph could not complete the email request.");
    }

    if (response.status === 204 || response.status === 202) {
        return null;
    }
    return response.json();
};

const readEmail = async (event) => {
    event.preventDefault();
    const messageId = document.getElementById("messageId").value.trim();
    const result = document.getElementById("emailResult");
    result.hidden = true;
    setStatus("readStatus", "Loading email...");

    try {
        const email = await makeEmailApiRequest(`/${encodeURIComponent(messageId)}`);
        document.getElementById("emailSubject").textContent = email.subject || "(No subject)";
        document.getElementById("emailSender").textContent =
            `From: ${email.from?.emailAddress?.address || "Unknown sender"}`;
        document.getElementById("emailReceived").textContent =
            email.receivedDateTime ? `Received: ${new Date(email.receivedDateTime).toLocaleString()}` : "";
        document.getElementById("emailBody").textContent = email.body?.content || "(No message body)";
        result.hidden = false;
        setStatus("readStatus", "Email loaded.");
    } catch (error) {
        setStatus("readStatus", error.message);
    }
};

const getEmailPayloadFromForm = () => {
    const cc = document.getElementById("ccRecipient").value.trim();
    return {
        to: document.getElementById("recipient").value.trim(),
        cc,
        subject: document.getElementById("subject").value.trim(),
        body: document.getElementById("body").value,
    };
};

const saveDraft = async () => {
    const form = document.getElementById("composeEmailForm");
    if (!form.reportValidity()) {
        return;
    }
    const email = getEmailPayloadFromForm();
    setStatus("composeStatus", "Saving draft...");
    try {
        const draft = await makeEmailApiRequest("/drafts", {
            method: "POST",
            body: JSON.stringify(email),
        });
        setStatus("composeStatus", `Draft saved${draft?.id ? ` (ID: ${draft.id})` : ""}.`);
    } catch (error) {
        setStatus("composeStatus", error.message);
    }
};

const sendEmail = async (event) => {
    event.preventDefault();
    const email = getEmailPayloadFromForm();
    setStatus("composeStatus", "Sending email...");
    try {
        await makeEmailApiRequest("/send", {
            method: "POST",
            body: JSON.stringify(email),
        });
        setStatus("composeStatus", "Email sent.");
    } catch (error) {
        setStatus("composeStatus", error.message);
    }
};

const initializeEmailPage = async () => {
    if (!emailProtected) {
        return;
    }

    try {
        if (await window.inboxOSDeveloperMode.revealProtectedPages()) {
            document.getElementById("userEmail").textContent = "Developer mode (OAuth disabled)";
            attachEmailPageHandlers();
            return;
        }
    } catch (error) {
        console.error("Unable to load application configuration.", error);
    }

    const accessToken = getAccessToken();
    if (!accessToken || sessionStorage.getItem("oauth_provider") !== "microsoft") {
        redirectToMicrosoftAuth();
        return;
    }

    try {
        const profile = await makeGraphRequest("/me?$select=displayName,mail,userPrincipalName");
        const authorizationResponse = await fetch(`${AUTH_SERVER_ORIGIN}/api/microsoft/authorization`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
            },
        });
        if (authorizationResponse.status === 401 || authorizationResponse.status === 403) {
            clearMicrosoftSession();
            redirectToMicrosoftAuth();
            return;
        }
        if (!authorizationResponse.ok) {
            throw new Error("Microsoft account authorization could not be verified.");
        }
        const authorization = await authorizationResponse.json();
        if (authorization.authorized !== true) {
            clearMicrosoftSession();
            redirectToMicrosoftAuth();
            return;
        }

        document.getElementById("userEmail").textContent =
            profile.mail || profile.userPrincipalName || profile.displayName || "Microsoft user";
        emailProtected.hidden = false;
    } catch (error) {
        const authRequired = document.getElementById("emailAuthRequired");
        authRequired.hidden = false;
        setStatus("emailAuthStatus", error.message || "Unable to verify your Microsoft sign-in.");
        return;
    }

    attachEmailPageHandlers();
};

const attachEmailPageHandlers = () => {
    document.getElementById("readEmailForm").addEventListener("submit", readEmail);
    document.getElementById("composeEmailForm").addEventListener("submit", sendEmail);
    document.getElementById("draftButton").addEventListener("click", saveDraft);
    document.getElementById("logoutButton").addEventListener("click", () => {
        clearMicrosoftSession();
        redirectToMicrosoftAuth();
    });
};

void initializeEmailPage();
