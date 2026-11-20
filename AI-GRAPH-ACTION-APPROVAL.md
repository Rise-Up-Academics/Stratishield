# InboxOS AI and Microsoft Graph Action Approval

## Overview

InboxOS Chat uses Anthropic for language understanding and Microsoft Graph for
mailbox and calendar data. The AI can use read tools to look up information and
can propose supported changes. It cannot execute a write tool directly from its
response: each proposed write is returned to the browser as a pending action,
explained to the user, and executed only after the user presses **Approve and
perform**.

Selecting **Cancel** discards the proposal. Nothing is changed by generating a
proposal or displaying its approval card.

## Request and approval flow

1. The browser sends the user's message, recent conversation history, and
   Microsoft bearer token to `POST /api/chat`.
2. The server validates the chat input and verifies the Microsoft identity,
   tenant, and any configured email allowlist.
3. The server starts `main.py --request`, passing the message, history, and
   bearer token over the child process's standard input.
4. Python fetches a bounded set of recent Graph messages and upcoming calendar
   events, retrieves relevant context, and sends that context and the available
   tool schemas to Anthropic.
5. Read tool calls are executed in Python against Microsoft Graph and their
   results are returned to Anthropic. Write tool calls are not executed. Python
   returns them as `pendingActions`, with a short readable summary of the
   operation and its supplied details.
6. The server validates each proposal against its write-tool allowlist, assigns
   it a cryptographically random ID, and stores the tool name, arguments,
   summary, expiration, and a hash of the requester's Microsoft token in
   memory. The response to the browser contains only the ID and summary, not
   executable code.
7. The chat displays an approval card. **Approve and perform** calls
   `POST /api/chat/actions/:actionId/approve`; **Cancel** calls
   `POST /api/chat/actions/:actionId/dismiss`.
8. The server revalidates the signed-in user and checks that the action exists,
   has not expired, and was proposed in the same token session. An approval is
   single-use. The server then starts `main.py --execute-tool` with the stored
   arguments, and Python performs the corresponding Graph request.
9. The UI reports completion only when the approval endpoint reports success.
   Graph or permission failures are shown as errors rather than success.

Pending actions expire after five minutes. They are held in a server-side
in-memory map, so a backend restart also discards outstanding proposals. An
approved action is removed from the map before execution; if Graph fails, that
approval cannot be replayed and the user must request the action again.

## Available tools

Tool schemas are declared in `tool_definitions()` in `main.py`; the matching
Microsoft Graph calls are implemented in `execute_tool()`.

### Read tools

These are read-only and can run as part of answering the chat request without
an approval card:

| Tool | Purpose and inputs | Microsoft Graph operation |
|---|---|---|
| `search_emails` | Search for mailbox messages. Required: `query` (string). Optional: `limit` (integer, 1–25; defaults to 10). | `GET /me/messages` with `$search`, a selected set of message fields, and `$top`. |
| `read_email` | Read a message. Required: `message_id` (string). | `GET /me/messages/{message_id}`. |
| `list_calendar_events` | List events in a range. Required: `start` and `end` (ISO 8601 strings). Optional: `limit` (integer, 1–50; defaults to 25). | `GET /me/calendarView` with the supplied range. |

### Write tools

Every tool below must first appear as a proposal and be individually approved
with the button. `update_email_read_status` is treated as a write because it
changes mailbox state.

| Tool | Purpose and inputs | Microsoft Graph operation |
|---|---|---|
| `update_email_read_status` | Mark a message read or unread. Required: `message_id` (string), `is_read` (boolean). | `PATCH /me/messages/{message_id}` with `isRead`. |
| `create_email_draft` | Create, but do not send, a draft. Required: `to`, `subject`, and `body` (strings). Optional: `cc` (string). | `POST /me/messages`. |
| `send_email` | Send a message. Required: `to`, `subject`, and `body` (strings). Optional: `cc` (string). | `POST /me/sendMail`. |
| `reply_to_email` | Reply to a message. Required: `message_id` and `comment` (strings). | `POST /me/messages/{message_id}/reply`. |
| `forward_email` | Forward a message. Required: `message_id` and `to` (strings). Optional: `comment` (string). | `POST /me/messages/{message_id}/forward`. |
| `delete_email` | Move a message to Deleted Items. Required: `message_id` (string). | `DELETE /me/messages/{message_id}`. |
| `create_calendar_event` | Create an event. Required: `subject`, `start`, `end`, `time_zone` (strings). Optional: `body`, `location` (strings), `attendees` (string array of email addresses). | `POST /me/events`. |
| `update_calendar_event` | Update an event. Required: `event_id` (string). Optional: `subject`, `start`, `end`, `time_zone`, `body`, `location` (strings), `attendees` (string array). Both `start` and `end` are needed when changing the time. | `PATCH /me/events/{event_id}`. |
| `delete_calendar_event` | Delete an event. Required: `event_id` (string). | `DELETE /me/events/{event_id}`. |

The tool schemas describe inputs for the AI; they do not grant Graph permissions.
The signed-in user's Microsoft delegated token and the app registration's
consented permissions determine whether Graph accepts an operation.

## Context supplied to the AI

For an authenticated request, `fetch_live_context()` in `main.py` retrieves:

- Up to 15 messages ordered by most recently received, selecting message ID,
  subject, sender, received time, preview, and read status.
- Up to 30 events from the current time through the next 14 days, selecting
  event ID, subject, preview, start/end, location, attendees, and organizer.

The records are passed through the repository's existing `retrieve()` helper
before being added to the Anthropic request. The AI can make further targeted
lookups with the read tools. Email and event contents are explicitly treated as
untrusted context: instructions inside those records do not authorize actions.

## Permission and safety boundaries

- The Microsoft OAuth scopes requested by the client are defined by
  `MICROSOFT_SCOPE` in `App.ts`. They include user profile, mail read/write/send,
  and calendar read/write scopes.
- `requireMicrosoftAuth` in `server.ts` validates the bearer token through
  Microsoft Graph and enforces the configured tenant. If
  `MICROSOFT_ALLOWED_EMAILS` is configured, it also restricts access to those
  addresses.
- The server only accepts pending tool names in `CHAT_WRITE_TOOL_NAMES`. Python
  separately restricts `--execute-tool` to `WRITE_TOOL_NAMES`.
- The approval endpoint does not accept a tool name or arguments from the
  browser. It looks up the server-stored proposal by random ID.
- The approval ID is single-use, short-lived, and bound to the proposing
  sign-in token using a SHA-256 token hash compared in constant time.
- Approval is per action. If the model proposes multiple writes, each has its
  own summary and approval/cancel controls.
- Action summaries are inserted into the page using `textContent`, not HTML
  rendering.
- Microsoft tokens and Graph calls stay in the application/backend flow; the
  Anthropic request receives Graph context and tool schemas, not the bearer
  token.

## Changed implementation surfaces

- `main.py`: live Graph context, tool definitions and execution, write-action
  summaries, proposal responses, and the explicit `--execute-tool` path.
- `server.ts`: Python process helper, write-tool validation, temporary
  server-side pending-action storage, and authenticated approve/dismiss routes.
- `chat.js`: displays pending action summaries and calls approve/dismiss routes.
- `styles/stylesheet.css`: approval-card and button layout.

## Validation

The implementation was checked with Python syntax and staged/approved action
tests, JavaScript syntax checking, the server TypeScript type-check, and
`git diff --check`. The action-flow tests use mocked Graph operations; they do
not send email or alter a real mailbox or calendar.
