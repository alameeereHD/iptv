const ProxyManager = (() => {
  const TOKEN_KEY = 'stream_token';
  const TOKEN_EXPIRY_KEY = 'stream_token_expiry';
  const TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;

  function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  function getToken() {
    const now = Date.now();
    const expiry = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
    if (now >= expiry) {
      const newToken = generateToken();
      const newExpiry = now + TOKEN_LIFETIME_MS;
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(newExpiry));
      return newToken;
    }
    return localStorage.getItem(TOKEN_KEY);
  }

  function startAutoRenew() {
    getToken();
    setInterval(() => {
      const now = Date.now();
      const expiry = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
      if (now >= expiry) getToken();
    }, 60 * 1000);
  }

  function buildProxiedUrl(originalUrl) {
    const token = getToken();
    const encoded = encodeURIComponent(originalUrl);
    return `/.netlify/functions/proxy?url=${encoded}&token=${token}`;
  }

  function minutesLeft() {
    const expiry = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
    return Math.max(0, Math.floor((expiry - Date.now()) / 60000));
  }

  return { getToken, buildProxiedUrl, startAutoRenew, minutesLeft };
})();
