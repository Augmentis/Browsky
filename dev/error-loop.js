#!/usr/bin/env node

// Browsky dev error loop
// - Connects to Chrome via CDP (remote debugging port 9222)
// - Watches all extension pages for console errors + uncaught exceptions
// - Pipes each error to `claude -p` with file context
// - Automatically applies the fix (claude has Edit/Write/Read tools)
// - Reuses the same claude session via --resume for full project context

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CDP_HOST = 'http://localhost:9222';
const PROJECT_DIR = path.resolve(__dirname, '..');
const EXTENSION_DIR = path.join(PROJECT_DIR, 'extension');
const SERVER_DIR = path.join(PROJECT_DIR, 'server');
const CLAUDE_SESSION_FILE = path.join(__dirname, '.claude-session-id');

let claudeSessionId = loadSessionId();
let errorQueue = Promise.resolve();
let seenErrors = new Set(); // deduplicate rapid-fire identical errors

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
  if (!res.ok) throw new Error('Chrome not reachable on port 9222. Did dev.sh start it?');
  return res.json();
}

function connectTarget(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new (require('ws'))(wsUrl);
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
  // Allow the same error to re-trigger after 10s (e.g. on reload)
  setTimeout(() => seenErrors.delete(key), 10_000);

  console.log('\n' + '─'.repeat(60));
  console.log(`ERROR [${err.type}] in ${err.source}`);
  console.log(`Location: ${err.location}`);
  console.log(`Message:  ${err.text}`);
  console.log('─'.repeat(60));
  console.log('Sending to Claude for auto-fix...\n');

  // Serialize — don't run multiple claude processes at once
  errorQueue = errorQueue.then(() => runClaudeFix(err));
}

// ── Claude fix ────────────────────────────────────────────────────────────────

function buildPrompt(err) {
  // Pull the relevant source file if we can identify it
  let sourceSnippet = '';
  const fileMatch = err.location.match(/\/([\w.-]+\.(?:js|html|css|json)):/);
  if (fileMatch) {
    const filename = fileMatch[1];
    const candidates = [
      path.join(EXTENSION_DIR, filename),
      path.join(SERVER_DIR, filename),
      path.join(PROJECT_DIR, 'native-host', filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        const lineNo = parseInt(err.location.split(':').at(-2)) || 0;
        const start = Math.max(0, lineNo - 10);
        const end = Math.min(lines.length, lineNo + 10);
        sourceSnippet = `\nRelevant source (${p}, lines ${start}-${end}):\n\`\`\`\n${lines.slice(start, end).join('\n')}\n\`\`\``;
        break;
      }
    }
  }

  return `A runtime error occurred in the Browsky Chrome extension.

Error type: ${err.type}
Source page: ${err.source}
Location: ${err.location}
Message: ${err.text}
${sourceSnippet}

Project root: ${PROJECT_DIR}

Please:
1. Identify the root cause
2. Fix it by editing the relevant file(s) in the project
3. Briefly explain what you changed and why

Apply the fix directly — do not just suggest it.`;
}

function runClaudeFix(err) {
  return new Promise((resolve) => {
    const prompt = buildPrompt(err);
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
                  '--allowedTools', 'Read,Edit,Write'];

    if (claudeSessionId) {
      args.push('--resume', claudeSessionId);
    }

    args.push(prompt);

    const proc = spawn('claude', args, {
      cwd: PROJECT_DIR,
      env: { ...process.env },
    });

    let buffer = '';
    let newSessionId = null;

    process.stdout.write('\x1b[32m'); // green
    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);

          // Capture session ID from result
          if (obj.type === 'result' && obj.session_id) {
            newSessionId = obj.session_id;
          }

          // Stream assistant text to terminal
          if (obj.type === 'assistant') {
            for (const block of obj.message?.content || []) {
              if (block.type === 'text') process.stdout.write(block.text);
            }
          }
          if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
            process.stdout.write(obj.delta.text);
          }
          if (obj.type === 'stream_event') {
            const ev = obj.event || obj;
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              process.stdout.write(ev.delta.text);
            }
          }
        } catch { /* non-JSON */ }
      }
    });

    proc.stderr.on('data', (d) => process.stderr.write(d));

    proc.on('close', (code) => {
      process.stdout.write('\x1b[0m\n'); // reset color
      if (newSessionId) {
        saveSessionId(newSessionId);
        console.log(`\nSession: ${newSessionId}`);
      }
      if (code !== 0) console.error(`claude exited with code ${code}`);
      console.log('\nWatching for next error...\n');
      resolve();
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure ws dep is available
  try { require('ws'); } catch {
    console.log('Installing ws...');
    execSync('npm install ws', { cwd: PROJECT_DIR + '/server', stdio: 'inherit' });
  }

  console.log('Browsky error loop');
  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Claude session: ${claudeSessionId || 'new'}\n`);

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
    console.warn('No extension targets found. Is Browsky loaded in Chrome?');
    console.warn('Targets available:', targets.map((t) => t.url).join('\n  '));
  }

  for (const t of extTargets) {
    await watchTarget(t);
  }

  console.log('\nWatching for errors. Trigger them in Chrome...\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
