#!/usr/bin/env node

// Generic Chrome extension dev error loop
// Reads project config from dev.config.json in the plugin root
// - Connects to Chrome via CDP
// - Watches all extension pages for console errors + uncaught exceptions
// - Pipes each error to `claude -p` with file context
// - Automatically applies the fix (claude has Read/Edit/Write tools)
// - Reuses the same claude session via --resume for full project context
// - Opens a new Terminal window per fix so you can follow along live

const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const CLAUDE_SESSION_FILE = path.join(__dirname, '.claude-session-id');

// ── Load config ───────────────────────────────────────────────────────────────

const configPath = path.join(PROJECT_DIR, 'dev.config.json');
if (!fs.existsSync(configPath)) {
  console.error(`No dev.config.json found at ${configPath}`);
  console.error('Copy Plugins/dev/dev.config.template.json to your plugin root and fill it in.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const CDP_HOST = `http://localhost:${config.cdpPort || 9222}`;

// ── State ─────────────────────────────────────────────────────────────────────

let claudeSessionId = loadSessionId();
let errorQueue = Promise.resolve();
let seenErrors = new Set();

// ── Session ID persistence ────────────────────────────────────────────────────

function loadSessionId() {
  try { return fs.readFileSync(CLAUDE_SESSION_FILE, 'utf8').trim() || null; }
  catch { return null; }
}

function saveSessionId(id) {
  claudeSessionId = id;
  fs.writeFileSync(CLAUDE_SESSION_FILE, id, 'utf8');
}

// ── Chrome CDP ────────────────────────────────────────────────────────────────

async function getTargets() {
  const res = await fetch(`${CDP_HOST}/json`);
  if (!res.ok) throw new Error(`Chrome not reachable on port ${config.cdpPort || 9222}. Did dev.sh start it?`);
  return res.json();
}

function connectTarget(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new (require(WS_PATH))(wsUrl);
    const pending = new Map();
    let seq = 1;

    ws.on('open', () => resolve({ ws, send }));
    ws.on('error', reject);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg.result);
      }
      if (msg.method) ws.emit('cdp_event', msg);
    });

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = seq++;
        pending.set(id, { resolve });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
  });
}

// ── Error watching per target ─────────────────────────────────────────────────

async function watchTarget(target) {
  const label = target.title || target.url || target.id;
  console.log(`  Watching: ${label}`);

  let client;
  try { client = await connectTarget(target.webSocketDebuggerUrl); }
  catch (e) { console.warn(`  Could not connect to ${label}: ${e.message}`); return; }

  const { ws, send } = client;
  await send('Runtime.enable');
  await send('Console.enable');

  ws.on('cdp_event', (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const ex = msg.params.exceptionDetails;
      const text = ex.exception?.description || ex.text || 'Unknown exception';
      const loc = ex.url ? `${ex.url}:${ex.lineNumber}:${ex.columnNumber}` : 'unknown location';
      handleError({ source: label, text, location: loc, type: 'exception' });
    }
    if (msg.method === 'Console.messageAdded') {
      const m = msg.params.message;
      if (m.level === 'error') {
        const loc = m.url ? `${m.url}:${m.line}:${m.column}` : 'unknown location';
        handleError({ source: label, text: m.text, location: loc, type: 'console.error' });
      }
    }
  });
}

// ── Error handler ─────────────────────────────────────────────────────────────

function handleError(err) {
  const key = `${err.source}|${err.text}`;
  if (seenErrors.has(key)) return;
  seenErrors.add(key);
  setTimeout(() => seenErrors.delete(key), 10_000);

  console.log('\n' + '─'.repeat(60));
  console.log(`ERROR [${err.type}] in ${err.source}`);
  console.log(`Location: ${err.location}`);
  console.log(`Message:  ${err.text}`);
  console.log('─'.repeat(60));
  console.log('Sending to Claude — opening new Terminal window...\n');

  errorQueue = errorQueue.then(() => runClaudeFix(err));
}

// ── Source context ────────────────────────────────────────────────────────────

function getSourceSnippet(location) {
  const fileMatch = location.match(/\/([\w.-]+\.(?:js|html|css|json)):/);
  if (!fileMatch) return '';

  const filename = fileMatch[1];
  const searchDirs = (config.sourceDirs || []).map((d) => path.join(PROJECT_DIR, d));
  searchDirs.push(PROJECT_DIR);

  for (const dir of searchDirs) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      const lineNo = parseInt(location.split(':').at(-2)) || 0;
      const start = Math.max(0, lineNo - 10);
      const end = Math.min(lines.length, lineNo + 10);
      return `\nRelevant source (${p}, lines ${start}–${end}):\n\`\`\`\n${lines.slice(start, end).join('\n')}\n\`\`\``;
    }
  }
  return '';
}

// ── Claude fix ────────────────────────────────────────────────────────────────

function buildPrompt(err) {
  return `A runtime error occurred in the ${config.name} Chrome extension.

Project: ${config.description}
Error type: ${err.type}
Source page: ${err.source}
Location: ${err.location}
Message: ${err.text}
${getSourceSnippet(err.location)}

Project root: ${PROJECT_DIR}
Source directories: ${(config.sourceDirs || []).join(', ')}

Please:
1. Identify the root cause
2. Fix it by editing the relevant file(s) in the project
3. Briefly explain what you changed and why

Apply the fix directly — do not just suggest it.`;
}

function runClaudeFix(err) {
  return new Promise((resolve) => {
    const prompt = buildPrompt(err);

    // Write prompt to a temp file to avoid shell escaping issues
    const tmpPrompt = path.join(__dirname, '.last-prompt.txt');
    fs.writeFileSync(tmpPrompt, prompt, 'utf8');

    const args = ['-p', '--output-format', 'stream-json', '--verbose',
                  '--allowedTools', 'Read,Edit,Write'];
    if (claudeSessionId) args.push('--resume', claudeSessionId);
    args.push(fs.readFileSync(tmpPrompt, 'utf8'));

    // Build the shell command to run in a new Terminal window
    const claudeCmd = ['claude', ...args.map((a) => `'${a.replace(/'/g, "'\\''")}'`)].join(' ');
    const termScript = `
      tell application "Terminal"
        activate
        do script "cd '${PROJECT_DIR}' && echo 'Claude fixing error in ${config.name}...' && ${claudeCmd}; echo; echo '[Done — window will stay open]'"
      end tell
    `;

    // Also run the process in background to capture session_id
    const proc = spawn('claude', args, {
      cwd: PROJECT_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'result' && obj.session_id) saveSessionId(obj.session_id);
        } catch { /* non-JSON */ }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) console.error(`claude exited with code ${code}`);
      console.log('Fix complete. Watching for next error...\n');
      resolve();
    });

    // Open Terminal window so user can watch
    exec(`osascript -e "${termScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (err) => {
      if (err) console.warn('Could not open Terminal window:', err.message);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Resolve ws from server/node_modules — that's where install.sh puts it
const WS_PATH = path.join(PROJECT_DIR, 'server', 'node_modules', 'ws');

async function main() {
  if (!fs.existsSync(WS_PATH)) {
    console.log('Installing server dependencies...');
    execSync('npm install', { cwd: path.join(PROJECT_DIR, 'server'), stdio: 'inherit' });
  }

  console.log(`\nBrowsky Dev — error feedback loop`);
  console.log(`Plugin:  ${config.name}`);
  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Claude session: ${claudeSessionId || 'will create on first error'}\n`);

  let targets;
  try {
    targets = await getTargets();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const extTargets = targets.filter((t) =>
    t.url?.startsWith('chrome-extension://') || t.type === 'service_worker'
  );

  if (extTargets.length === 0) {
    console.warn('No extension targets found. Is the extension loaded in Chrome?');
    console.warn('Available targets:\n  ' + targets.map((t) => t.url).join('\n  '));
  }

  for (const t of extTargets) await watchTarget(t);

  console.log('Watching for errors. Trigger them in Chrome...\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
