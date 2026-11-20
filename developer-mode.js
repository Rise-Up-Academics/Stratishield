"use strict";

(() => {
    let configPromise;

    const getConfig = () => {
        if (!configPromise) {
            configPromise = fetch("http://localhost:5500/api/config")
                .then(async (response) => {
                    if (!response.ok) {
                        throw new Error("Application configuration could not be loaded.");
                    }
                    const config = await response.json();
                    if (typeof config?.developerMode !== "boolean") {
                        throw new Error("Application configuration is invalid.");
                    }
                    return config;
                })
                .catch((error) => {
                    configPromise = undefined;
                    throw error;
                });
        }
        return configPromise;
    };

    const revealProtectedPages = async () => {
        const { developerMode } = await getConfig();
        if (!developerMode) {
            return false;
        }

        activateDeveloperMode();
        document.querySelectorAll("[data-auth-protected]").forEach((page) => {
            page.hidden = false;
        });
        document.querySelectorAll("[data-auth-required]").forEach((page) => {
            page.hidden = true;
        });
        return true;
    };

    const activateDeveloperMode = () => {
        document.documentElement.dataset.developerMode = "true";
    };

    window.inboxOSDeveloperMode = {
        isEnabled: async () => {
            const { developerMode } = await getConfig();
            if (developerMode) {
                activateDeveloperMode();
            }
            return developerMode;
        },
        isBypassActive: () => document.documentElement.dataset.developerMode === "true",
        revealProtectedPages,
    };
})();
