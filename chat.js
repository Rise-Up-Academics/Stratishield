const CHAT_BACKEND_ORIGIN = 'http://localhost:5500';
const CHAT_ENDPOINT = '/api/chat';

const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const chatMessages = document.getElementById('chatMessages');
const chatStatus = document.getElementById('chatStatus');
const sendButton = document.getElementById('sendButton');

if (
    chatForm instanceof HTMLFormElement &&
    messageInput instanceof HTMLInputElement &&
    chatMessages instanceof HTMLElement &&
    chatStatus instanceof HTMLElement &&
    sendButton instanceof HTMLButtonElement
) {
    const conversationId = crypto.randomUUID();
    const conversationHistory = [];

    function displayMessage(role, content) {
        const message = document.createElement('div');
        message.classList.add('message');
        message.classList.add(
            role === 'user' ? 'user-message' : 'assistant-message',
        );
        message.textContent = `${role === 'user' ? 'You' : 'AI'}: ${content}`;
        chatMessages.appendChild(message);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const accessToken = sessionStorage.getItem('oauth_access_token');
        if (accessToken) {
            headers.Authorization = 'Bearer ' + accessToken;
        }
        return headers;
    }

    async function readResponse(response) {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(
                data && typeof data.error === 'string'
                    ? data.error
                    : 'The request failed. Please try again.',
            );
        }
        return data;
    }

    function displayPendingAction(action) {
        const card = document.createElement('article');
        card.classList.add('message', 'assistant-message', 'action-approval-card');

        const heading = document.createElement('strong');
        heading.textContent = 'Approval required';
        card.appendChild(heading);

        const summary = document.createElement('pre');
        summary.textContent = action.summary;
        card.appendChild(summary);

        const controls = document.createElement('div');
        controls.classList.add('action-approval-controls');
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.textContent = 'Approve and perform';
        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.textContent = 'Cancel';
        controls.append(approveButton, dismissButton);
        card.appendChild(controls);
        chatMessages.appendChild(card);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        const finish = (message) => {
            controls.remove();
            const result = document.createElement('p');
            result.textContent = message;
            card.appendChild(result);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        };

        approveButton.addEventListener('click', async () => {
            approveButton.disabled = true;
            dismissButton.disabled = true;
            approveButton.textContent = 'Performing...';
            try {
                const response = await fetch(
                    `${CHAT_BACKEND_ORIGIN}${CHAT_ENDPOINT}/actions/${encodeURIComponent(action.id)}/approve`,
                    { method: 'POST', headers: getAuthHeaders() },
                );
                await readResponse(response);
                const confirmation = `Approved and completed: ${action.summary.split('\n')[0]}.`;
                finish(confirmation);
                conversationHistory.push({ role: 'assistant', content: confirmation });
                conversationHistory.splice(0, Math.max(0, conversationHistory.length - 20));
            } catch (error) {
                finish(error instanceof Error ? error.message : 'The action could not be completed.');
            }
        });

        dismissButton.addEventListener('click', async () => {
            approveButton.disabled = true;
            dismissButton.disabled = true;
            try {
                const response = await fetch(
                    `${CHAT_BACKEND_ORIGIN}${CHAT_ENDPOINT}/actions/${encodeURIComponent(action.id)}/dismiss`,
                    { method: 'POST', headers: getAuthHeaders() },
                );
                await readResponse(response);
                finish('Action cancelled. Nothing was changed.');
            } catch (error) {
                finish(error instanceof Error ? error.message : 'The action could not be cancelled.');
            }
        });
    }

    async function sendMessageToAI(userMessage) {
        const response = await fetch(
            CHAT_BACKEND_ORIGIN + CHAT_ENDPOINT,
            {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    conversationId,
                    message: userMessage,
                    conversationHistory,
                }),
            },
        );
        const data = await readResponse(response);
        if (!data || typeof data.answer !== 'string') {
            throw new Error('The AI service returned an invalid response.');
        }
        if (
            data.pendingActions !== undefined &&
            (!Array.isArray(data.pendingActions) ||
                data.pendingActions.some(
                    (action) =>
                        !action ||
                        typeof action.id !== 'string' ||
                        typeof action.summary !== 'string',
                ))
        ) {
            throw new Error('The AI service returned an invalid action approval request.');
        }
        return data;
    }

    chatForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const userMessage = messageInput.value.trim();
        if (!userMessage || sendButton.disabled) {
            return;
        }

        displayMessage('user', userMessage);
        conversationHistory.push({ role: 'user', content: userMessage });
        conversationHistory.splice(0, Math.max(0, conversationHistory.length - 20));
        messageInput.value = '';
        messageInput.disabled = true;
        sendButton.disabled = true;
        chatStatus.textContent = 'Thinking...';

        try {
            const result = await sendMessageToAI(userMessage);
            conversationHistory.push({ role: 'assistant', content: result.answer });
            conversationHistory.splice(0, Math.max(0, conversationHistory.length - 20));
            displayMessage('assistant', result.answer);
            (result.pendingActions || []).forEach(displayPendingAction);
            chatStatus.textContent = '';
        } catch (error) {
            console.error('Chat error:', error);
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : 'Unable to get a response. Please try again.';
            displayMessage('assistant', errorMessage);
            chatStatus.textContent = 'The request failed. You can try again.';
        } finally {
            messageInput.disabled = false;
            sendButton.disabled = false;
            messageInput.focus();
        }
    });
}
