const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*'
  };
}

function fetchStream(targetUrl, extraHeaders, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('too many redirects'));
    const parsed = url.parse(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path || '/',
      method: 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }, extraHeaders || {}),
      timeout: 30000,
      rejectUnauthorized: false
    };
    const req = lib.request(options, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        const location = res.headers['location'];
        if (!location) return reject(new Error('no location'));
        const newUrl = location.startsWith('http') ? location : parsed.protocol + '//' + parsed.host + location;
        return resolve(fetchStream(newUrl, extraHeaders, redirectCount + 1));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buffer: Buffer.concat(chunks)
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function rewriteM3u8(content, originalUrl) {
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return '/proxy?url=' + encodeURIComponent(trimmed);
    }
    return '/proxy?url=' + encodeURIComponent(baseUrl + trimmed);
  }).join('\n');
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (parsed.pathname === '/proxy') {
    const targetUrl = parsed.query.url;
    if (!targetUrl) { res.writeHead(400, corsHeaders()); res.end('missing url'); return; }
    let decodedUrl;
    try { decodedUrl = decodeURIComponent(targetUrl); }
    catch(e) { res.writeHead(400, corsHeaders()); res.end('invalid url'); return; }
    if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) {
      res.writeHead(403, corsHeaders()); res.end('forbidden'); return;
    }
    try {
      const extra = {};
      if (req.headers['range']) extra['Range'] = req.headers['range'];
      const resp = await fetchStream(decodedUrl, extra);
      const ct = resp.headers['content-type'] || '';
      const isM3u8 = decodedUrl.includes('.m3u8') || ct.includes('mpegurl');
      const isTs = decodedUrl.includes('.ts') || ct.includes('mp2t');
      const headers = Object.assign({}, corsHeaders(), { 'Cache-Control': 'no-cache' });

      if (isM3u8) {
        headers['Content-Type'] = 'application/vnd.apple.mpegurl';
        const rewritten = rewriteM3u8(resp.buffer.toString('utf8'), decodedUrl);
        res.writeHead(200, headers);
        res.end(rewritten);
      } else if (isTs) {
        headers['Content-Type'] = 'video/mp2t';
        res.writeHead(resp.status || 200, headers);
        res.end(resp.buffer);
      } else {
        headers['Content-Type'] = ct || 'application/octet-stream';
        res.writeHead(resp.status || 200, headers);
        res.end(resp.buffer);
      }
    } catch(err) {
      console.error('[proxy error]', err.message, decodedUrl);
      res.writeHead(502, corsHeaders());
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, corsHeaders()); res.end('Not Found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, Object.assign({}, corsHeaders(), {
      'Content-Type': MIME[ext] || 'text/plain'
    }));
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port', PORT);
});
