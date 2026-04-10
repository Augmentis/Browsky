# Browsky — Technical Specification

## Overview

Browsky is a Chrome extension + local server that provides a persistent AI chat interface accessible from any webpage. It supports parallel sessions backed by either the Claude Code CLI or a locally running Ollama instance.

---

## 1. Components

### 1.1 Chrome Extension (Manifest V3)

**Permissions required:**
- `sidePanel` — render the sidebar
- `nativeMessaging` — trigger server launch
- `storage` — persist session list and user preferences
- `tabs` — detect active tab for context (future use)

**Entry points:**
- `background.js` — service worker; handles icon click, WebSocket lifecycle, native messaging call
- `sidebar.html` / `sidebar.js` — primary UI, rendered in Chrome Side Panel
- `popup.html` / `popup.js` — compact popup view (same React-less component logic)
- `styles.css` — shared design system

**Sidebar vs Popup toggle:**
- Default view: sidebar (Chrome Side Panel API)
- Toggle button in header switches to popup mode
- Preference persisted in `chrome.storage.local`

---

### 1.2 Local WebSocket Server

**Runtime:** Node.js 18+  
**Port:** `3457` (fixed, not configurable in v1)  
**Protocol:** WebSocket (`ws://localhost:3457`)

**Message format (client → server):**
```json
{
  "type": "chat",
  "sessionId": "uuid",
  "content": "user message text"
}
```

**Message format (server → client):**
```json
{ "type": "stream_chunk",  "sessionId": "uuid", "text": "partial response" }
{ "type": "stream_end",    "sessionId": "uuid" }
{ "type": "error",         "sessionId": "uuid", "message": "..." }
{ "type": "models",        "models": ["llama3.2", "mistral", ...] }
{ "type": "session_ready", "sessionId": "uuid" }
```

**Session lifecycle:**
- `new_session` message from client creates a session entry
- Claude sessions: spawn `claude -p --output-format stream-json`, track `session_id` from first response JSON for `--resume` on subsequent messages
- Ollama sessions: stateless POST to `http://localhost:11434/api/chat` with accumulated message history maintained server-side per session
- Sessions persist in memory until server restart or explicit `close_session` message

---

### 1.3 Native Launcher (Native Messaging Host)

**Purpose:** sole job is to start the Node.js server if it is not already running.

**Registration manifest** (`com.augmentis.browsky.json`):
```json
{
  "name": "com.augmentis.browsky",
  "description": "Browsky server launcher",
  "path": "/path/to/native-host/launcher.js",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://EXTENSION_ID/"]
}
```
Installed at: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`

**Launcher logic:**
1. Check if `localhost:3457` is already accepting connections
2. If not, spawn `node /path/to/server/index.js` as a detached background process
3. Send `{"status": "ok"}` back to the extension and exit

The launcher is invoked once per browser session (background.js tracks this in memory).

---

## 2. UI Design

### Design language
- Follows Claude's visual style: neutral dark sidebar, clean typography, minimal chrome
- Font: system-ui / -apple-system stack
- Color tokens:
  - Background: `#1a1a1a` (sidebar), `#2a2a2a` (message area)
  - User bubble: `#2f6feb` (blue)
  - Assistant bubble: none (flat, left-aligned prose)
  - Accent: `#d97706` (amber, for model selector highlight)
  - Text: `#e5e5e5` primary, `#999` secondary

### Layout (sidebar mode)
```
┌─────────────────────────┐
│  Browsky  [≡] [↗ popup] │  ← header
├──────────┬──────────────┤
│ Sessions │ Chat area    │  ← session list (collapsible) + active chat
│  • s1    │ ...messages  │
│  • s2    │              │
│  [+ New] │              │
├──────────┴──────────────┤
│  [input box]     [Send] │  ← input
└─────────────────────────┘
```

### New Session flow
1. Click **+ New** in session panel
2. Modal appears:
   - "Claude" button
   - "Local Model" button → shows dropdown of Ollama models (fetched from server)
3. Session created, focus moves to input

### Streaming rendering
- Tokens append in place as they arrive
- Cursor blink animation while streaming
- Auto-scroll to bottom unless user has scrolled up

---

## 3. Claude CLI Integration

**Command per message:**
- First message in session: `claude -p --output-format stream-json "<message>"`
- Subsequent messages: `claude -p --output-format stream-json --resume <session_id> "<message>"`

**Session ID extraction:**  
Parse the `session_id` field from the final `result` JSON object in the stream.

**Working directory:**  
Server uses its own directory as cwd. Sessions are stored at `~/.claude/projects/<encoded-server-cwd>/`.

**Stream parsing:**  
Each newline-delimited JSON object from stdout is forwarded as a `stream_chunk` to the extension. Objects with `type: "result"` signal end of turn.

---

## 4. Ollama Integration

**Model discovery:**  
`GET http://localhost:11434/api/tags` → returns `{ models: [{ name, size, ... }] }`  
Called on server startup and on each new session creation. Result broadcast as `models` message.

**Chat API:**  
`POST http://localhost:11434/api/chat`  
```json
{
  "model": "llama3.2",
  "messages": [ { "role": "user", "content": "..." }, ... ],
  "stream": true
}
```
Server maintains message history array per Ollama session. Each response chunk is forwarded as `stream_chunk`.

---

## 5. install.sh Responsibilities

1. Run `npm install` in `server/`
2. Make `native-host/launcher.js` executable
3. Patch the extension ID placeholder in `com.augmentis.browsky.json` (user provides it after loading unpacked extension)
4. Patch the absolute path to `launcher.js` in the manifest
5. Copy manifest to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
6. Print next steps

---

## 6. Out of Scope (v1)

- Firefox support
- Windows / Linux install
- Conversation history persistence across server restarts
- RAG / file attachments
- Authentication / multi-user
- Remote Claude API (non-CLI) as a backend
