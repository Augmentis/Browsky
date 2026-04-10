# Browsky

A Chrome extension that brings an AI chat sidebar to any webpage. Supports multi-session parallel conversations with Claude (via Claude Code CLI) or any locally running Ollama model.

## Features

- Persistent sidebar panel on any page, toggleable to a popup
- Multiple parallel chat sessions — start new sessions while keeping existing ones open
- Each session independently configured to use Claude CLI or a local Ollama model
- Streaming responses
- Claude-inspired UI

## Architecture

```
Chrome Extension (sidebar/popup UI)
        ↕  WebSocket  (ws://localhost:3457)
Local Node.js Server  (started on extension icon click, via native launcher)
        ├── Spawns:   claude -p --output-format stream-json  (per session)
        └── Proxies:  http://localhost:11434  (Ollama API)
```

The native launcher is a minimal native messaging host whose sole job is to start the Node.js server on first use. All ongoing communication happens over WebSocket.

## Project Structure

```
Browsky/
├── extension/          # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js   # service worker — manages WS connection + server launch
│   ├── sidebar.html    # main chat UI
│   ├── sidebar.js      # session management, message rendering
│   ├── popup.html      # compact popup view
│   ├── popup.js
│   └── styles.css      # Claude-inspired design tokens + layout
│
├── server/             # local Node.js WebSocket server
│   ├── index.js        # WS server, session routing
│   ├── claude.js       # spawns claude CLI, manages session IDs
│   ├── ollama.js       # proxies Ollama API, lists available models
│   └── package.json
│
├── native-host/        # minimal native messaging host (launch only)
│   ├── launcher.js     # starts server if not running, then exits
│   └── com.augmentis.browsky.json
│
├── install.sh          # registers native host, installs server deps
├── SPEC.md             # full technical specification
└── TODO.md             # implementation checklist
```

## Setup

### Prerequisites
- macOS
- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- [Ollama](https://ollama.ai) installed (optional, for local models)
- Node.js 18+

### Install

```bash
git clone https://github.com/Augmentis/Browsky.git
cd Browsky
./install.sh
```

Then load the `extension/` folder as an unpacked extension in `chrome://extensions`.

## Usage

1. Click the Browsky icon in Chrome toolbar — server starts automatically
2. The sidebar opens on the right side of the page
3. Click **New Session** — choose Claude or a local Ollama model
4. Chat. Start more sessions anytime from the session panel.
5. Toggle between sidebar and popup using the layout switch in the header.
