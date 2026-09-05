// 零依赖静态服务器（供本地预览 / iPad 真机联调）
//   node server.js [port]          仅监听 127.0.0.1（默认 8642）
//   node server.js [port] --lan    监听 0.0.0.0，并打印局域网 URL（iPad 上打开）
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const ARGS = process.argv.slice(2);
const LAN = ARGS.includes('--lan');
const PORT = Number(ARGS.find(a => /^\d+$/.test(a)) || process.env.PORT || 8642);
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const EXPORT_DIR = path.join(ROOT, 'exports');
const MAX_JSON_BYTES = 5 * 1024 * 1024;   // /save-json 上限 5MB
const MAX_PNG_BYTES = 64 * 1024 * 1024;   // /save-png 上限（base64 文本）

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, text, extra) {
  if (res.writableEnded) return;
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, extra || {}));
  res.end(text == null ? '' : String(text));
}

// 413：先回应、再排空剩余请求体，避免客户端卡在上传
function tooLarge(req, res, limit) {
  send(res, 413, `Payload Too Large (limit ${limit} bytes)`, { Connection: 'close' });
  req.resume();
}

// 读取请求体；超限时已回 413 并 resolve(null)，调用方直接 return
function readBody(req, res, limit) {
  return new Promise(resolve => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { tooLarge(req, res, limit); return resolve(null); }
    const chunks = [];
    let size = 0, done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; chunks.length = 0; tooLarge(req, res, limit); return resolve(null); }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', () => { if (!done) { done = true; resolve(null); } });
  });
}

function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

// 解析并校验路径：畸形编码 / 空字节 / 越界 → 抛出带 status 的错误
function resolveRequest(rawUrl) {
  let url;
  try { url = new URL(rawUrl, 'http://x'); } catch (e) { throw Object.assign(new Error('Bad URL'), { status: 400 }); }
  let urlPath;
  try { urlPath = decodeURIComponent(url.pathname); } catch (e) { throw Object.assign(new Error('Bad percent-encoding'), { status: 400 }); }
  if (urlPath.includes('\0')) throw Object.assign(new Error('Null byte in path'), { status: 400 });
  return { url, urlPath };
}

async function savePng(req, res) {
  const body = await readBody(req, res, MAX_PNG_BYTES);
  if (body === null) return;
  const b64 = body.toString().replace(/^data:image\/png;base64,/, '');
  const name = 'export-' + Date.now() + '.png';
  ensureExportDir();
  fs.writeFileSync(path.join(EXPORT_DIR, name), Buffer.from(b64, 'base64'));
  console.log(`[save-png] exports/${name}`);
  send(res, 200, 'exports/' + name);
}

async function saveJson(req, res, url) {
  const rawName = url.searchParams.get('name');
  const prefix = rawName == null || rawName === '' ? 'data' : rawName;
  if (!/^[a-z0-9-]{1,40}$/.test(prefix)) return send(res, 400, 'Bad name: only [a-z0-9-] allowed');
  const body = await readBody(req, res, MAX_JSON_BYTES);
  if (body === null) return;
  const text = body.toString('utf8');
  try { JSON.parse(text); } catch (e) { return send(res, 400, 'Body is not valid JSON: ' + e.message); }
  const name = `${prefix}-${Date.now()}.json`;
  ensureExportDir();
  fs.writeFileSync(path.join(EXPORT_DIR, name), text);
  console.log(`[save-json] exports/${name} (${body.length} bytes)`);
  send(res, 200, 'exports/' + name);
}

function serveStatic(res, urlPath) {
  let file = path.normalize(path.join(ROOT, urlPath));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  // readFile 的同步异常（非法参数等）也兜住，回调里的错误统一 404
  try {
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not Found');
      if (res.writableEnded) return;
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  } catch (e) {
    send(res, 400, 'Bad path: ' + e.message);
  }
}

function handle(req, res) {
  let parsed;
  try { parsed = resolveRequest(req.url); }
  catch (e) { return send(res, e.status || 400, e.message); }
  const { url, urlPath } = parsed;

  if (req.method === 'POST' && urlPath === '/save-png') {
    return savePng(req, res).catch(e => send(res, 500, String(e)));
  }
  if (req.method === 'POST' && urlPath === '/save-json') {
    return saveJson(req, res, url).catch(e => send(res, 500, String(e)));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD, POST' });
  serveStatic(res, urlPath);
}

const server = http.createServer((req, res) => {
  try { handle(req, res); }
  catch (e) {
    console.error('[handler error]', req.url, e);
    send(res, 500, 'Internal Server Error');
  }
});

// Expect: 100-continue 时先看 Content-Length，超限直接 413，客户端不必上传整个 body
server.on('checkContinue', (req, res) => {
  const declared = Number(req.headers['content-length']);
  const limit = req.url.startsWith('/save-json') ? MAX_JSON_BYTES : MAX_PNG_BYTES;
  if (Number.isFinite(declared) && declared > limit) return tooLarge(req, res, limit);
  res.writeContinue();
  server.emit('request', req, res);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用（另一个 server.js 还在跑？）：${e.message}`);
  else console.error('[server error]', e);
  process.exit(1);
});

function lanIPv4s() {
  const out = [];
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal) out.push({ ifname, address: a.address });
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log(`bimo dev server: http://localhost:${PORT}  (listening on ${HOST}:${PORT})`);
  if (LAN) {
    const ips = lanIPv4s();
    if (!ips.length) {
      console.log('  --lan: 未发现局域网 IPv4 地址（未连 Wi-Fi？）');
    } else {
      console.log('  --lan: 在 iPad Safari（同一 Wi-Fi）打开：');
      for (const { ifname, address } of ips) {
        console.log(`    [${ifname}]  http://${address}:${PORT}/probe.html   （探针）`);
        console.log(`    ${' '.repeat(ifname.length + 2)}  http://${address}:${PORT}/              （工作台）`);
      }
    }
  } else {
    console.log('  仅本机可访问；iPad 联调请加 --lan：node server.js ' + PORT + ' --lan');
  }
});
