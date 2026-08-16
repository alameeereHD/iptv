const https = require('https');
const http  = require('http');
const url   = require('url');

const HEADERS = {
  'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
  'Accept': '*/*',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive'
};

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
}

function rewriteM3u8(text, originalUrl) {
  const base = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      return t.replace(/URI="([^"]+)"/g, (_m, u) => {
        const abs = u.startsWith('http') ? u : base + u;
        return `URI="/api/stream?url=${encodeURIComponent(abs)}"`;
      });
    }
    const abs = t.startsWith('http') ? t : base + t;
    return `/api/stream?url=${encodeURIComponent(abs)}`;
  }).join('\n');
}

function fetchUrl(targetUrl, extraHeaders, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('too many redirects'));
    const parsed  = url.parse(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path || '/',
      method: 'GET',
      headers: Object.assign({}, HEADERS, extraHeaders || {}),
      timeout: 20000,
      rejectUnauthorized: false
    };
    const req = lib.request(opts, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        const loc = res.headers['location'];
        if (!loc) return reject(new Error('no location'));
        const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.host}${loc}`;
        return resolve(fetchUrl(next, extraHeaders, hops + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }
  const params = event.queryStringParameters || {};
  const target = params.url;
  if (!target) return { statusCode: 400, headers: cors(), body: 'missing url' };
  let decoded;
  try { decoded = decodeURIComponent(target); }
  catch(e) { return { statusCode: 400, headers: cors(), body: 'invalid url' }; }
  if (!decoded.startsWith('http://') && !decoded.startsWith('https://')) {
    return { statusCode: 403, headers: cors(), body: 'forbidden' };
  }
  try {
    const extra = {};
    const range = event.headers && (event.headers['range'] || event.headers['Range']);
    if (range) extra['Range'] = range;
    const resp = await fetchUrl(decoded, extra);
    const ct   = resp.headers['content-type'] || '';
    const isM3u8 = /mpegurl|m3u/i.test(ct) || /\.m3u8(\?|$)/i.test(decoded);
    const isTs   = /mp2t/i.test(ct)         || /\.ts(\?|$)/i.test(decoded);
    const outHeaders = Object.assign({}, cors(), { 'Cache-Control': 'no-store' });
    if (isM3u8) {
      outHeaders['Content-Type'] = 'application/vnd.apple.mpegurl';
      const rewritten = rewriteM3u8(resp.buffer.toString('utf8'), decoded);
      return { statusCode: 200, headers: outHeaders, body: rewritten };
    }
    outHeaders['Content-Type'] = isTs ? 'video/mp2t' : (ct || 'application/octet-stream');
    if (resp.headers['accept-ranges']) outHeaders['Accept-Ranges'] = resp.headers['accept-ranges'];
    if (resp.headers['content-range']) outHeaders['Content-Range'] = resp.headers['content-range'];
    return {
      statusCode:      resp.status || 200,
      headers:         outHeaders,
      body:            resp.buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch(err) {
    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: err.message
