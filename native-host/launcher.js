#!/usr/bin/env node

// Native messaging host — sole purpose is to start the Browsky server
// if it isn't already running, then exit.
// Chrome communicates via 4-byte little-endian length-prefixed JSON on stdin/stdout.

const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

function readMessage(cb) {
  let headerBuf = Buffer.alloc(0);

  process.stdin.on('readable', () => {
    let chunk;
    while (null !== (chunk = process.stdin.read())) {
      headerBuf = Buffer.concat([headerBuf, chunk]);

      if (headerBuf.length >= 4) {
        const msgLength = headerBuf.readUInt32LE(0);
        if (headerBuf.length >= 4 + msgLength) {
          const msgBody = headerBuf.slice(4, 4 + msgLength).toString('utf8');
          try { cb(JSON.parse(msgBody)); } catch { cb({}); }
          return;
        }
      }
    }
  });
}

function sendMessage(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.alloc(4 + Buffer.byteLength(json));
  buf.writeUInt32LE(Buffer.byteLength(json), 0);
  buf.write(json, 4, 'utf8');
  process.stdout.write(buf);
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(600);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, '127.0.0.1');
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

readMessage(async () => {
  const running = await isPortOpen(3457);

  if (!running) {
    const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
    const child = spawn('node', [serverEntry], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    // Wait for it to bind
    await wait(800);
  }

  sendMessage({ status: 'ok' });
  process.exit(0);
});
