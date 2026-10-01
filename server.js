const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);
const MAX_BYTES = 25 * 1024 * 1024;
const MIME_EXT = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/aac': '.aac' };
let messages = {};
let writeQueue = Promise.resolve();

async function persist() {
  writeQueue = writeQueue.then(() => fs.writeFile(path.join(DATA, 'messages.json'), JSON.stringify(messages, null, 2)));
  return writeQueue;
}
function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function json(req, res, status, data) { send(res, status, data); }
function safeEqual(a, b) { const x = Buffer.from(a || ''); const y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function configuredGitHub() { return process.env.GITHUB_TOKEN && process.env.GITHUB_REPO; }

async function githubRequest(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? null : response.json();
}
async function githubPut(item, bytes) {
  const [owner, repo] = process.env.GITHUB_REPO.split('/');
  const branch = process.env.GITHUB_BRANCH || 'main';
  const prefix = (process.env.GITHUB_PATH || 'voice-messages').replace(/^\/+|\/+$/g, '');
  const filename = `${prefix}/${item.id}${item.ext}`;
  await githubRequest(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Store one-time voice message ${item.id}`, content: bytes.toString('base64'), branch }) });
  return filename;
}
async function githubDelete(filename) {
  if (!configuredGitHub() || !filename) return;
  const [owner, repo] = process.env.GITHUB_REPO.split('/');
  const branch = process.env.GITHUB_BRANCH || 'main';
  const file = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}?ref=${encodeURIComponent(branch)}`);
  await githubRequest(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Delete listened voice message ${path.basename(filename)}`, sha: file.sha, branch }) });
}
async function loadMessageBytes(item) {
  if (item.githubPath && configuredGitHub()) {
    const [owner, repo] = process.env.GITHUB_REPO.split('/');
    const file = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/contents/${item.githubPath}?ref=${encodeURIComponent(process.env.GITHUB_BRANCH || 'main')}`);
    if (file.content) return Buffer.from(file.content.replace(/\n/g, ''), 'base64');
    // GitHub omits inline file content for larger blobs; use its authenticated download URL.
    const download = await fetch(file.download_url, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.raw+json' } });
    if (!download.ok) throw new Error(`GitHub audio download returned ${download.status}`);
    return Buffer.from(await download.arrayBuffer());
  }
  return fs.readFile(path.join(DATA, item.id + item.ext));
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveStatic(res, 'index.html');
  if (req.method === 'GET' && url.pathname === '/js/app.js') return serveStatic(res, 'js/app.js');
  if (req.method === 'GET' && url.pathname === '/css/styles.css') return serveStatic(res, 'css/styles.css');
  if (req.method === 'GET' && /^\/listen\/[a-f0-9]{48}$/.test(url.pathname)) return serveStatic(res, 'listen.html');
  if (req.method === 'GET' && url.pathname === '/health') return json(req, res, 200, { ok: true });

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const supplied = req.headers['x-upload-key'];
    if (process.env.UPLOAD_KEY && !safeEqual(supplied, process.env.UPLOAD_KEY)) return json(req, res, 401, { error: 'Upload key is not valid.' });
    const mime = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) return json(req, res, 415, { error: 'Use a supported audio file (WebM, Ogg, MP4/M4A, MP3, WAV, or AAC).' });
    const chunks = []; let size = 0; let tooLarge = false;
    try {
      // Drain the request before replying to an oversized upload so the browser
      // receives a complete JSON error instead of a truncated response.
      for await (const chunk of req) {
        if (tooLarge) continue;
        size += chunk.length;
        if (size > MAX_BYTES) { tooLarge = true; chunks.length = 0; continue; }
        chunks.push(chunk);
      }
      if (tooLarge) return json(req, res, 413, { error: 'Audio must be 25 MB or smaller.' });
      if (!size) return json(req, res, 400, { error: 'The recording is empty.' });
      const bytes = Buffer.concat(chunks);
      const id = crypto.randomBytes(24).toString('hex');
      const item = { id, ext, mime, createdAt: new Date().toISOString(), used: false, githubPath: null };
      if (configuredGitHub()) item.githubPath = await githubPut(item, bytes);
      else await fs.writeFile(path.join(DATA, id + ext), bytes, { flag: 'wx' });
      messages[id] = item; await persist();
      return json(req, res, 201, { url: `/listen/${id}`, storage: item.githubPath ? 'github' : 'server' });
    } catch (err) { console.error('Upload failed:', err); return json(req, res, 500, { error: 'Upload failed. Check the server terminal for details, then retry.' }); }
  }

  const match = url.pathname.match(/^\/api\/messages\/([a-f0-9]{48})(\/claim)?$/);
  if (match && req.method === 'GET' && !match[2]) {
    const item = messages[match[1]];
    return item && !item.used ? json(req, res, 200, { available: true }) : json(req, res, 410, { available: false, error: 'This voice message has already been listened to or is unavailable.' });
  }
  if (match && req.method === 'POST' && match[2]) {
    const item = messages[match[1]];
    if (!item || item.used) return json(req, res, 410, { error: 'This voice message has already been listened to or is unavailable.' });
    // Set used and persist before sending any audio. Concurrent claims lose the race.
    item.used = true;
    try { await persist(); } catch (err) { item.used = false; console.error(err); return json(req, res, 500, { error: 'Could not reserve this message.' }); }
    try {
      const bytes = await loadMessageBytes(item);
      if (item.githubPath) await githubDelete(item.githubPath).catch(err => console.error('GitHub cleanup failed:', err.message));
      else await fs.unlink(path.join(DATA, item.id + item.ext)).catch(() => {});
      res.writeHead(200, { 'Content-Type': item.mime, 'Content-Length': bytes.length, 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
      return res.end(bytes);
    } catch (err) { console.error(err); return json(req, res, 500, { error: 'Could not retrieve this message. It has been consumed; ask the sender for a new link.' }); }
  }
  return json(req, res, 404, { error: 'Not found.' });
}
async function serveStatic(res, filename) {
  const types = { 'index.html': 'text/html; charset=utf-8', 'listen.html': 'text/html; charset=utf-8', 'js/app.js': 'text/javascript; charset=utf-8', 'css/styles.css': 'text/css; charset=utf-8' };
  try { const body = await fs.readFile(path.join(ROOT, filename)); res.writeHead(200, { 'Content-Type': types[filename], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); }
  catch { res.writeHead(500); res.end('Could not load site files.'); }
}

(async () => {
  await fs.mkdir(DATA, { recursive: true });
  try { messages = JSON.parse(await fs.readFile(path.join(DATA, 'messages.json'), 'utf8')); } catch { messages = {}; }
  http.createServer((req, res) => handle(req, res).catch(err => { console.error(err); if (!res.headersSent) json(req, res, 500, { error: 'Unexpected server error.' }); else res.destroy(); })).listen(PORT, () => console.log(`Once Voice running on port ${PORT}`));
})();
