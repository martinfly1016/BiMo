// 零依赖静态服务器（供本地预览：node server.js [port]）
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8642);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  // 保存端点：页面 POST base64 PNG → 写入 exports/ 目录（供导出对比图等）
  if (req.method === 'POST' && urlPath === '/save-png') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString();
        const b64 = body.replace(/^data:image\/png;base64,/, '');
        const name = 'export-' + Date.now() + '.png';
        const dir = path.join(ROOT, 'exports');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('exports/' + name);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
    return;
  }

  let file = path.normalize(path.join(ROOT, urlPath));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log(`bimo dev server: http://localhost:${PORT}`));
