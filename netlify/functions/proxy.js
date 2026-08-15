const https = require('https');
const http  = require('http');
const url   = require('url');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive'
};

function getContentType(reqUrl, serverType) {
  if (reqUrl.includes('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (reqUrl.includes('.ts'))   return 'video/mp2t';
  if (reqUrl.includes('.mp4'))  return 'video/mp4';
  return serverType || 'application/octet-stream';
}

function rewriteM3u8(content, originalUrl, proxyBase) {
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return `${proxyBase}${encodeURIComponent(trimmed)}`;
    return `${proxyBase}${encodeURIComponent(baseUrl + trimmed)}`;
  }).join('\n');
}

function fetchUrl(targetUrl, extraHeaders, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('too many redirects'));
    const parsed  = url.parse(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path || '/',
      method: 'GET',
      headers: Object.assign({}, BROWSER_HEADERS, extraHeaders || {}),
      timeout: 20000,
      rejectUnauthorized: false
    };
    const req = lib.request(options, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        const location = res.headers['location'];
        if (!location) return reject(new Error('redirect without location'));
        const newUrl = location.startsWith('http') ? location : parsed.protocol + '//' + parsed.host + location;
        return resolve(fetchUrl(newUrl, extraHeaders, redirectCount + 1));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  const params = event.queryStringParameters || {};
  const targetUrl = params.url;
  if (!targetUrl) return { statusCode: 400, headers: corsHeaders(), body: 'missing url' };
  let decodedUrl;
  try { decodedUrl = decodeURIComponent(targetUrl); } catch(e) { return { statusCode: 400, headers: corsHeaders(), body: 'invalid url' }; }
  if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) return { statusCode: 403, headers: corsHeaders(), body: 'forbidden' };
  try {
    const extra = {};
    const rangeHdr = event.headers && (event.headers['range'] || event.headers['Range']);
    if (rangeHdr) extra['Range'] = rangeHdr;
    const resp = await fetchUrl(decodedUrl, extra);
    const serverCT = resp.headers['content-type'] || '';
    const contentType = getContentType(decodedUrl, serverCT);
    const isM3u8 = contentType.includes('mpegurl') || decodedUrl.includes('.m3u8');
    if (isM3u8) {
      const rewritten = rewriteM3u8(resp.buffer.toString('utf8'), decodedUrl, '/.netlify/functions/proxy?url=');
      return { statusCode: resp.status || 200, headers: Object.assign({}, corsHeaders(), { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' }), body: rewritten };
    }
    return { statusCode: resp.status || 200, headers: Object.assign({}, corsHeaders(), { 'Content-Type': contentType, 'Cache-Control': 'no-cache' }), body: resp.buffer.toString('base64'), isBase64Encoded: true };
  } catch(err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
