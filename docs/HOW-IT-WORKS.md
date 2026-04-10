# Dev Error Loop — How It Works

## What it does

When you run `./dev/dev.sh`, any `console.error` or uncaught exception in the
Chrome extension gets automatically sent to Claude, which reads the relevant
source file and applies a fix — without you doing anything.

---

## Step by step

### 1. `dev.sh` launches Chrome with a debug port open

```
Google Chrome --remote-debugging-port=9222 --user-data-dir=./dev/.chrome-dev-profile
```

Chrome exposes a WebSocket endpoint on that port called the
**Chrome DevTools Protocol (CDP)**. This is the same protocol DevTools itself
uses internally. A separate sandboxed profile is used so it doesn't touch your
regular Chrome.

### 2. `error-loop.js` connects to Chrome over CDP

It calls `http://localhost:9222/json` which returns a list of all open "targets"
(tabs, service workers, extension pages). It filters for extension targets:

```
chrome-extension://...  ← sidebar, popup
service_worker          ← background.js
```

For each target it opens a WebSocket connection and sends two CDP commands:
- `Runtime.enable` — activates runtime events (uncaught exceptions)
- `Console.enable` — activates console events (console.error calls)

### 3. Chrome streams errors back in real time

Two CDP events are listened for:

| CDP Event | Catches |
|---|---|
| `Runtime.exceptionThrown` | Uncaught JS exceptions (e.g. `Cannot read properties of undefined`) |
| `Console.messageAdded` (level: error) | Explicit `console.error(...)` calls |

Each event includes the error message, the source file URL, and the line/column number.

### 4. Deduplication

Rapid-fire identical errors (same source + message) are suppressed for 10 seconds.
This prevents a single bug that fires on every render from flooding Claude with
20 identical fix requests.

### 5. Source context is extracted

The file name is parsed from the error location. `error-loop.js` looks for a
matching file across the dirs listed in `dev.config.json` → `sourceDirs`:

```json
"sourceDirs": ["extension", "server", "native-host"]
```

If found, it reads ±10 lines around the error line and includes them in the
prompt so Claude has immediate context without needing to search.

### 6. The prompt is built and sent to Claude

Claude is invoked as a subprocess:

```bash
claude -p \
  --output-format stream-json \
  --allowedTools Read,Edit,Write \
  --resume <session-id> \
  "<error details + source snippet + project root path>"
```

The prompt tells Claude:
- What the error is and where it happened
- The surrounding source lines
- The project root and which dirs contain source
- To apply the fix directly, not just suggest it

`--allowedTools Read,Edit,Write` means Claude can read any file in the project,
edit existing files, and write new ones — but cannot run shell commands.

### 7. Session continuity via `--resume`

The first error creates a new Claude session. The `session_id` from Claude's
JSON output is saved to `dev/.claude-session-id`.

Every subsequent error uses `--resume <session_id>` so Claude accumulates
context across fixes — it remembers what it already changed, what the
architecture is, and what previous errors were. This is much more effective
than starting fresh each time.

### 8. Two parallel outputs

Claude runs twice for each error:

- **Background process** — captures `session_id` from the JSON stream and saves it
- **New Terminal window** — opened via AppleScript, runs the same Claude command
  so you can watch the fix stream live in a dedicated window

The background process is what actually applies the fix. The Terminal window is
purely for visibility.

---

## Data flow

```
Chrome extension (sidebar / background.js)
        │  console.error() / uncaught exception
        ▼
CDP WebSocket (localhost:9222)
        │  Runtime.exceptionThrown / Console.messageAdded event
        ▼
error-loop.js
        │  parse error + extract source snippet
        ▼
claude -p --resume <id> --allowedTools Read,Edit,Write
        │  reads files, edits source, writes fix
        ▼
Plugin source files updated on disk
        +
New Terminal window streaming Claude's explanation
```

---

## Config

`dev.config.json` in the plugin root controls everything:

```json
{
  "name": "Browsky",
  "description": "...",
  "sourceDirs": ["extension", "server", "native-host"],
  "cdpPort": 9222
}
```

- **`sourceDirs`** — where to search for the file named in the error location
- **`cdpPort`** — change this if you run multiple plugins simultaneously (9222, 9223, ...)

---

## Files created by the loop

| File | Purpose |
|---|---|
| `dev/.claude-session-id` | Persisted Claude session ID for `--resume` |
| `dev/.chrome-dev-profile/` | Isolated Chrome profile (safe to delete to reset) |
| `dev/.last-prompt.txt` | Last prompt sent to Claude (useful for debugging the loop itself) |

All three are gitignored.
