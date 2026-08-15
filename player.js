function loadScript(src, cb) {
  const s = document.createElement('script');
  s.src = src; s.onload = cb;
  document.head.appendChild(s);
}

let hlsInstance = null, mpegtsPlayer = null, currentIndex = -1, labelTimer = null;
const video = document.getElementById('video-player');
const qualityMenu = document.getElementById('quality-menu');
const channelLabel = document.getElementById('channel-label');

const loadingOverlay = (() => {
  const el = document.createElement('div');
  el.id = 'loading-overlay';
  el.innerHTML = '<div class="spinner"></div><span>جاري التحميل...</span>';
  document.getElementById('player-container').appendChild(el);
  return el;
})();

function showLoading() { loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }

function buildChannelButtons() {
  const bar = document.getElementById('channels-bar');
  bar.innerHTML = '';
  CHANNELS.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'channel-btn';
    btn.id = `ch-btn-${i}`;
    btn.textContent = ch.name;
    btn.onclick = () => loadChannel(i);
    bar.appendChild(btn);
  });
}

function loadChannel(index) {
  const ch = CHANNELS[index];
  if (!ch || !ch.url) { alert('هذه القناة لا تحتوي على رابط بعد.'); return; }
  document.querySelectorAll('.channel-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`ch-btn-${index}`);
  if (activeBtn) activeBtn.classList.add('active');
  currentIndex = index;
  showLoading();
  destroyCurrentPlayer();
  clearQualityMenu();
  showChannelLabel(ch.name);
  const url = ProxyManager.buildProxiedUrl(ch.url);
  if (ch.type === 'hls' || ch.url.includes('.m3u8')) { playHLS(url); } else { playTS(url); }
}

function playHLS(url) {
  if (typeof Hls === 'undefined') { loadScript('https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js', () => playHLS(url)); return; }
  if (Hls.isSupported()) {
    hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, (e, data) => { hideLoading(); video.play().catch(()=>{}); buildQualityMenu(data.levels); });
    hlsInstance.on(Hls.Events.ERROR, (e, data) => {
      if (data.fatal) {
        hideLoading();
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hlsInstance && hlsInstance.startLoad(), 3000);
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hlsInstance.recoverMediaError();
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.addEventListener('loadedmetadata', () => { hideLoading(); video.play().catch(()=>{}); });
  }
}

function playTS(url) {
  if (typeof mpegts === 'undefined') { loadScript('https://cdn.jsdelivr.net/npm/mpegts.js@latest/dist/mpegts.min.js', () => playTS(url)); return; }
  if (mpegts.isSupported()) {
    mpegtsPlayer = mpegts.createPlayer({ type: 'mpegts', url, isLive: true, enableWorker: true, enableStashBuffer: false });
    mpegtsPlayer.attachMediaElement(video);
    mpegtsPlayer.load();
    mpegtsPlayer.play().then(() => hideLoading()).catch(() => hideLoading());
    mpegtsPlayer.on(mpegts.Events.ERROR, () => hideLoading());
  } else {
    video.src = url; video.load(); video.play().then(() => hideLoading()).catch(() => hideLoading());
  }
}

function buildQualityMenu(levels) {
  qualityMenu.innerHTML = '';
  if (!levels || levels.length <= 1) return;
  const autoBtn = document.createElement('button');
  autoBtn.className = 'quality-option active';
  autoBtn.textContent = 'تلقائي';
  autoBtn.onclick = () => setQuality(-1, autoBtn);
  qualityMenu.appendChild(autoBtn);
  levels.forEach((level, i) => {
    const btn = document.createElement('button');
    btn.className = 'quality-option';
    btn.textContent = level.height ? `${level.height}p` : `مستوى ${i+1}`;
    btn.onclick = () => setQuality(i, btn);
    qualityMenu.appendChild(btn);
  });
}

function setQuality(levelIndex, clickedBtn) {
  if (hlsInstance) hlsInstance.currentLevel = levelIndex;
  document.querySelectorAll('.quality-option').forEach(b => b.classList.remove('active'));
  clickedBtn.classList.add('active');
  qualityMenu.classList.add('hidden');
}

function clearQualityMenu() { qualityMenu.innerHTML = ''; qualityMenu.classList.add('hidden'); }
function toggleQualityMenu() { qualityMenu.classList.toggle('hidden'); }

function togglePlay() {
  if (video.paused) { video.play(); document.getElementById('btn-play').textContent = '⏸'; }
  else { video.pause(); document.getElementById('btn-play').textContent = '▶'; }
}

function setVolume(val) { video.volume = parseFloat(val); video.muted = parseFloat(val) === 0; }

function toggleFullscreen() {
  const wrapper = document.getElementById('player-container');
  if (!document.fullscreenElement) wrapper.requestFullscreen && wrapper.requestFullscreen();
  else document.exitFullscreen && document.exitFullscreen();
}

function showChannelLabel(name) {
  channelLabel.textContent = name;
  channelLabel.classList.remove('fade');
  if (labelTimer) clearTimeout(labelTimer);
  labelTimer = setTimeout(() => channelLabel.classList.add('fade'), 3000);
}

function destroyCurrentPlayer() {
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  if (mpegtsPlayer) { mpegtsPlayer.unload(); mpegtsPlayer.detachMediaElement(); mpegtsPlayer.destroy(); mpegtsPlayer = null; }
  video.removeAttribute('src'); video.load();
}

document.addEventListener('click', (e) => {
  if (!document.getElementById('quality-wrapper').contains(e.target)) qualityMenu.classList.add('hidden');
});

let controlsTimer;
document.getElementById('player-container').addEventListener('touchstart', () => {
  const pc = document.getElementById('player-container');
  pc.classList.add('show-controls');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => pc.classList.remove('show-controls'), 3000);
});

video.addEventListener('play', () => { document.getElementById('btn-play').textContent = '⏸'; });
video.addEventListener('pause', () => { document.getElementById('btn-play').textContent = '▶'; });
video.addEventListener('waiting', showLoading);
video.addEventListener('playing', hideLoading);
video.addEventListener('canplay', hideLoading);

document.addEventListener('DOMContentLoaded', () => {
  ProxyManager.startAutoRenew();
  buildChannelButtons();
  loadChannel(0);
});
