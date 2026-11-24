// ===== 設定 =====
const LAYOUTS = [
  { id: '2x2', label: '2×2（4枚）', cols: 2, rows: 2 },
  { id: '1x2', label: '縦2枚',     cols: 1, rows: 2 },
  { id: '2x1', label: '横2枚',     cols: 2, rows: 1 },
  { id: '2x3', label: '2×3（6枚）', cols: 2, rows: 3 },
  { id: '3x3', label: '3×3（9枚）', cols: 3, rows: 3 },
];
const OUT_W = 3840, OUT_H = 2160; // 書き出しサイズ固定
const BG = '#000000';             // 背景色固定
const CAPTION_HEIGHT = 160;
const DETECT_MAX = 1280;          // 目の検出用に縮小する最大辺(px)

// ===== 状態 =====
const state = { layout: LAYOUTS[0], images: [], gap: 16, caption: '', blurOn: false, blurSize: 1.2 };
let targetCell = null;

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
canvas.width = OUT_W;
canvas.height = OUT_H;

// ===== 描画 =====
function draw() {
  const { cols, rows } = state.layout;
  const g = state.gap;
  const capH = state.caption ? CAPTION_HEIGHT : 0;
  const cw = (OUT_W - g * (cols + 1)) / cols;
  const ch = (OUT_H - capH - g * (rows + 1)) / rows;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  for (let i = 0; i < cols * rows; i++) {
    const x = g + (i % cols) * (cw + g);
    const y = g + Math.floor(i / cols) * (ch + g);
    const img = state.images[i];
    if (img) {
      drawCover(img, x, y, cw, ch);
      if (state.blurOn && img.eyes) blurEyes(img, x, y, cw, ch);
    } else {
      ctx.fillStyle = '#222';
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = '#666';
      ctx.font = `${Math.min(cw, ch) * 0.25}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', x + cw / 2, y + ch / 2);
    }
  }

  if (state.caption) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.caption, OUT_W / 2, OUT_H - capH / 2 - g / 2, OUT_W - 120);
  }
}

function drawCover(img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// ===== 目元ぼかし =====
function blurEyes(img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const ox = (img.width - w / r) / 2, oy = (img.height - h / r) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); // マスの外にはみ出さない
  for (const e of img.eyes) {
    const cx = x + (e.x - ox) * r;
    const cy = y + (e.y - oy) * r;
    const rad = e.r * r * state.blurSize;
    blurCircle(cx, cy, rad);
  }
  ctx.restore();
}

function blurCircle(cx, cy, rad) {
  const size = Math.max(4, Math.round(rad * 2));
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = size;
  const t = tmp.getContext('2d');
  t.fillStyle = BG; t.fillRect(0, 0, size, size);
  t.drawImage(canvas, cx - rad, cy - rad, rad * 2, rad * 2, 0, 0, size, size);

  const id = t.getImageData(0, 0, size, size);
  boxBlur(id.data, size, size, Math.max(2, Math.round(rad * 0.3)));
  t.putImageData(id, 0, 0);

  // 縁をなめらかにする丸いマスク
  t.globalCompositeOperation = 'destination-in';
  const grad = t.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.7, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  t.fillStyle = grad; t.fillRect(0, 0, size, size);

  ctx.drawImage(tmp, cx - rad, cy - rad, rad * 2, rad * 2);
}

function blur1D(src, dst, w, h, r, horiz) {
  const len = horiz ? w : h, lines = horiz ? h : w;
  const step = horiz ? 4 : w * 4, lineStep = horiz ? w * 4 : 4;
  const div = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[base + Math.min(len - 1, Math.max(0, i)) * step + c];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = sum / div;
        sum += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
      }
    }
  }
}
function boxBlur(d, w, h, r) {
  const t = new Uint8ClampedArray(d);
  for (let p = 0; p < 3; p++) { blur1D(d, t, w, h, r, true); blur1D(t, d, w, h, r, false); }
}

// ===== 目の検出（MediaPipe Face Landmarker） =====
let landmarkerPromise = null;
function getLandmarker() {
  if (!landmarkerPromise) {
    const base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    landmarkerPromise = import(base + '/+esm').then(async (mp) => {
      const fileset = await mp.FilesetResolver.forVisionTasks(base + '/wasm');
      return mp.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        },
        runningMode: 'IMAGE',
        numFaces: 6,
      });
    });
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}

async function detectEyes(img, lm) {
  const s = Math.min(1, DETECT_MAX / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const res = lm.detect(c);
  const eyes = [];
  for (const face of res.faceLandmarks) {
    // [目尻, 目頭] の組：左目(33,133) 右目(362,263)
    for (const [a, b] of [[33, 133], [362, 263]]) {
      const p = face[a], q = face[b];
      const ax = p.x * img.width, ay = p.y * img.height;
      const bx = q.x * img.width, by = q.y * img.height;
      eyes.push({ x: (ax + bx) / 2, y: (ay + by) / 2, r: Math.hypot(ax - bx, ay - by) * 0.8 });
    }
  }
  return eyes;
}

async function ensureEyes() {
  const targets = state.images.filter((im) => im && !im.eyes);
  if (!targets.length) return;
  setStatus('目の検出中…（初回はモデル読み込みに数秒かかります）');
  try {
    const lm = await getLandmarker();
    for (const im of targets) im.eyes = await detectEyes(im, lm);
    const none = state.images.filter((im) => im && im.eyes.length === 0).length;
    setStatus(none ? `顔を検出できなかった写真が ${none} 枚あります` : '');
  } catch (err) {
    console.error(err);
    setStatus('目の検出に失敗しました。ネット接続を確認してください。');
    state.blurOn = false; $('blurOn').checked = false; $('blurSizeWrap').hidden = true;
  }
  draw();
}
function setStatus(t) { $('status').textContent = t; }

// ===== 画像読み込み =====
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

// ===== イベント =====
LAYOUTS.forEach((l, i) => $('layout').add(new Option(l.label, i)));
$('layout').onchange = (e) => { state.layout = LAYOUTS[e.target.value]; draw(); };
$('gap').oninput = (e) => { state.gap = +e.target.value; $('gapOut').textContent = state.gap + 'px'; draw(); };
$('caption').oninput = (e) => { state.caption = e.target.value; draw(); };

$('blurOn').onchange = (e) => {
  state.blurOn = e.target.checked;
  $('blurSizeWrap').hidden = !state.blurOn;
  if (state.blurOn) ensureEyes(); else { setStatus(''); draw(); }
};
$('blurSize').oninput = (e) => {
  state.blurSize = e.target.value / 100;
  $('blurSizeOut').textContent = e.target.value + '%';
  draw();
};

$('pick').onclick = () => $('files').click();
$('files').onchange = async (e) => {
  const imgs = await Promise.all([...e.target.files].map(loadImage));
  state.images = imgs.slice(0, state.layout.cols * state.layout.rows);
  e.target.value = '';
  draw();
  if (state.blurOn) ensureEyes();
};

canvas.onclick = (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (OUT_W / rect.width);
  const py = (e.clientY - rect.top) * (OUT_H / rect.height);
  const { cols, rows } = state.layout;
  const g = state.gap, capH = state.caption ? CAPTION_HEIGHT : 0;
  const cw = (OUT_W - g * (cols + 1)) / cols;
  const ch = (OUT_H - capH - g * (rows + 1)) / rows;
  const col = Math.floor((px - g / 2) / (cw + g));
  const row = Math.floor((py - g / 2) / (ch + g));
  if (col < 0 || col >= cols || row < 0 || row >= rows) return;
  targetCell = row * cols + col;
  $('one').click();
};
$('one').onchange = async (e) => {
  if (e.target.files[0] && targetCell !== null) {
    state.images[targetCell] = await loadImage(e.target.files[0]);
    draw();
    if (state.blurOn) ensureEyes();
  }
  e.target.value = '';
};

$('clear').onclick = () => { state.images = []; setStatus(''); draw(); };

// 保存：押したらそのままダウンロード
$('save').onclick = () => {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    a.download = `collage_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
};

$('gapOut').textContent = state.gap + 'px';
$('blurSizeOut').textContent = '120%';
draw();
