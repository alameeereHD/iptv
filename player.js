const STORAGE_KEY = 'extra-channels';
const video       = document.getElementById('video');
const overlay     = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const chLabel     = document.getElementById('ch-label');
const statusBadge = document.getElementById('status-badge');
const qualityMenu = document.getElementById('quality-menu');

let hlsInstance   = null;
let mpegtsPlayer  = null;
let labelTimer    = null;
let extraChannels = [];
let activeId      = null;

function proxy(url) {
  return '/api/stream?url=' + encodeURIComponent(url);
}

function loadExtra() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) extraChannels = JSON.parse(raw);
  } catch { extraChannels = []; }
}

function saveExtra() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(extraChannels)); } catch {}
}

function buildGrid() {
  const grid = document.getElementById('channels-grid');
  grid.innerHTML = '';
  const all = [...CHANNELS, ...extraChannels];
  all.forEach(ch => {
    if (!ch.url) return;
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'ch-btn' + (ch.id === activeId ? ' active' : '');
    btn.id = 'ch-' + ch.id;
    btn.textContent = ch.name;
    btn.title = ch.name;
    btn.onclick = () => loadChannel(ch);
    wrap.appendChild(btn);
    if (extraChannels.find(c => c.id === ch.id)) {
      const del = document.createElement('button');
      del.className = 'ch-del';
      del.textContent = '×';
      del.onclick = (e) => {
        e.stopPropagation();
        extraChannels = extraChannels.filter(c => c.id !== ch.id);
        saveExtra();
        if (activeId === ch.id) { destroyPlayer(); setStatus('idle'); activeId = null; }
        buildGrid();
      };
      wrap.appendChild(del);
    }
    grid.appendChild(wrap);
  });
}

function loadChannel(ch) {
  activeId = ch.id;
  buildGrid();
  destroyPlayer();
  setStatus('loading', 'جارٍ الاتصال بالقناة…');
  showLabel(ch.name);
  const isM3u8 = /\.m3u8(\?|$)/i.test(ch.url);
  const isTs   = /\.ts(\?|$)/i.test(ch.url);
  if (isM3u8) {
    playHLS(ch.url);
  } else if (isTs) {
    const hlsUrl = ch.url.replace(/\.ts(\?|$)/i, '.m3u8$1');
    playHLSwithFallback(hlsUrl, ch.url);
  } else {
    playHLS(ch.url);
  }
}

function playHLSwithFallback(hlsUrl, tsUrl) {
  if (!Hls.isSupported()) { playTS(tsUrl); return; }
  const hls = new Hls({ lowLatencyMode: true, enableWorker: true, startLevel: 0 });
  let settled = false;
  const timeout = setTimeout(() => {
    if (!settled) { settled = true; hls.destroy(); playTS(tsUrl); }
  }, 10000);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    hlsInstance = { destroy: () => hls.destroy() };
    buildQualityMenu(hls.levels, (i) => { hls.currentLevel = i; hls.loadLevel = i; });
    video.play().catch(() => {});
    setStatus('playing');
  });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    if (!settled) { settled = true; clearTimeout(timeout); hls.destroy(); playTS(tsUrl); }
    else setStatus('error', 'انقطع البث، اختر القناة مرة أخرى.');
  });
  hls.loadSource(proxy(hlsUrl));
  hls.attachMedia(video);
}

function playHLS(url) {
  if (!Hls.isSupported()) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = proxy(url);
      video.play().catch(() => {});
      setStatus('playing');
    } else {
      setStatus('error', 'هذا المتصفح لا يدعم HLS.');
    }
    return;
  }
  const hls = new Hls({ lowLatencyMode: true, enableWorker: true, startLevel: 0 });
  hlsInstance = { destroy: () => hls.destroy() };
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    buildQualityMenu(hls.levels, (i) => { hls.currentLevel = i; hls.loadLevel = i; });
    video.play().catch(() => {});
    setStatus('playing');
  });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls.startLoad(), 3000);
    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else setStatus('error', 'تعذّر تشغيل القناة.');
  });
  hls.loadSource(proxy(url));
  hls.attachMedia(video);
}

function playTS(url) {
  if (!mpegts.isSupported()) { setStatus('error', 'هذا المتصفح لا يدعم تشغيل هذا البث.'); return; }
  const player = mpegts.createPlayer(
    { type: 'mpegts', isLive: true, url: proxy(url) },
    { enableStashBuffer: false, liveBufferLatencyChasing: true, lazyLoad: false }
  );
  mpegtsPlayer = { destroy: () => player.destroy() };
  player.attachMediaElement(video);
  player.load();
  player.on(mpegts.Events.ERROR, () => setStatus('error', 'تعذّر تشغيل القناة.'));
  player.play().then(() => setStatus('playing')).catch(() => setStatus('playing'));
}

function buildQualityMenu(levels, setLevel) {
  qualityMenu.innerHTML = '';
  if (!levels || levels.length <= 1) { qualityMenu.classList.remove('open'); return; }
  const auto = document.createElement('button');
  auto.className = 'q-opt active';
  auto.textContent = 'تلقائي';
  auto.onclick = () => { setLevel(-1); setActive(auto); toggleQuality(); };
  qualityMenu.appendChild(auto);
  levels.forEach((l, i) => {
    const btn = document.createElement('button');
    btn.className = 'q-opt';
    btn.textContent = l.height ? l.height+'p' : (l.bitrate ? Math.round(l.bitrate/1000)+' kbps' : 'جودة '+(i+1));
    btn.onclick = () => { setLevel(i); setActive(btn); toggleQuality(); };
    qualityMenu.appendChild(btn);
  });
  function setActive(el) {
    qualityMenu.querySelectorAll('.q-opt').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }
}

function setStatus(state, text) {
  statusBadge.className = state;
  if (state === 'playing') {
    statusBadge.textContent = 'مباشر';
    overlay.classList.add('hidden');
  } else if (state === 'loading') {
    statusBadge.textContent = 'تحميل…';
    overlayText.textContent = text || 'جارٍ التحميل…';
    overlay.classList.remove('hidden');
  } else if (state === 'error') {
    statusBadge.textContent = 'خطأ';
    overlayText.textContent = text || 'حدث خطأ.';
    overlay.classList.remove('hidden');
  } else {
    statusBadge.textContent = 'متوقف';
    overlayText.textContent = text || 'اختر قناة من القائمة أدناه';
    overlay.classList.remove('hidden');
  }
}

function showLabel(name) {
  chLabel.textContent = name;
  chLabel.classList.remove('fade');
  if (labelTimer) clearTimeout(labelTimer);
  labelTimer = setTimeout(() => chLabel.classList.add('fade'), 3000);
}

function destroyPlayer() {
  if (hlsInstance)  { hlsInstance.destroy();  hlsInstance  = null; }
  if (mpegtsPlayer) { mpegtsPlayer.destroy();  mpegtsPlayer = null; }
  video.removeAttribute('src');
  video.load();
  qualityMenu.innerHTML = '';
  qualityMenu.classList.remove('open');
}

function togglePlay() { if (video.paused) video.play(); else video.pause(); }
function setVolume(v) { video.volume = parseFloat(v); }
function toggleFS() {
  const el = document.getElementById('player-container');
  if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
  else document.exitFullscreen && document.exitFullscreen();
}
function toggleQuality() { qualityMenu.classList.toggle('open'); }
function toggleForm() { document.getElementById('add-form').classList.toggle('hidden'); }
function addChannel() {
  const name = document.getElementById('form-name').value.trim();
  const url  = document.getElementById('form-url').value.trim();
  if (!name || !url) return;
  extraChannels.push({ id: 'e'+Date.now(), name, url });
  saveExtra();
  buildGrid();
  document.getElementById('form-name').value = '';
  document.getElementById('form-url').value  = '';
  document.getElementById('add-form').classList.add('hidden');
}

document.addEventListener('click', e => {
  if (!document.getElementById('quality-wrap').contains(e.target)) qualityMenu.classList.remove('open');
});

let ctrlTimer;
document.getElementById('player-container').addEventListener('touchstart', () => {
  const pc = document.getElementById('player-container');
  pc.classList.add('show-ctrl');
  clearTimeout(ctrlTimer);
  ctrlTimer = setTimeout(() => pc.classList.remove('show-ctrl'), 3000);
});

video.addEventListener('play',    () => { document.getElementById('btn-play').textContent = '⏸'; });
video.addEventListener('pause',   () => { document.getElementById('btn-play').textContent = '▶'; });
video.addEventListener('waiting', () => setStatus('loading', 'جارٍ التحميل…'));
video.addEventListener('playing', () => setStatus('playing'));

loadExtra();
buildGrid();
