// ===== 設定 =====
const VERSION = '4';
const OUT_W = 3840, OUT_H = 2160;   // 書き出しサイズ（固定）
const BG_EXPORT = '#000000';        // 書き出し時の背景色（黒）
const BG_PREVIEW = '#2c2c2e';       // プレビュー時の背景色（仕切り線）
const COLS = 2, ROWS = 2;           // 2×2固定（余白なし）
const CW = OUT_W / COLS, CH = OUT_H / ROWS;
const DETECT_MAX = 1280;            // 目の検出用に縮小する最大辺(px)
const ZOOM_MAX = 5;
const MAX_MANUAL = 6;
const CELL_NAMES = ['左上', '右上', '左下', '右下'];

// ===== 状態 =====
// cells[i] = { img, zoom, cx, cy }  cx,cy = 表示範囲の中心（画像ピクセル座標）
// img.eyes = [{x, y, r}]（画像ピクセル座標。自動検出または手動）
const state = { cells: [null, null, null, null], blurOn: false, blurSize: 1.0 };
let targetCell = null;
let curBg = BG_PREVIEW;
let statusMsg = '';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
canvas.width = OUT_W;
canvas.height = OUT_H;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const allFilled = () => state.cells.every(Boolean);

// 画像をトリミング範囲つきで描画。使った変換情報を返す
function drawImg(c2, img, t, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height) * t.zoom;
  const sw = w / r, sh = h / r;
  const cx = clamp(t.cx, sw / 2, img.width - sw / 2);
  const cy = clamp(t.cy, sh / 2, img.height - sh / 2);
  const sx = cx - sw / 2, sy = cy - sh / 2;
  c2.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  return { sx, sy, r };
}

// ===== プレビュー／書き出し描画 =====
function draw(forExport = false) {
  curBg = forExport ? BG_EXPORT : BG_PREVIEW;
  ctx.fillStyle = forExport ? BG_EXPORT : BG_PREVIEW;
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  for (let i = 0; i < COLS * ROWS; i++) {
    const x = (i % COLS) * CW;
    const y = Math.floor(i / COLS) * CH;
    const cell = state.cells[i];
    if (cell) {
      const m = drawImg(ctx, cell.img, cell, x, y, CW, CH);
      if (state.blurOn && cell.img.eyes) blurEyes(cell.img, m, x, y);
    } else if (!forExport) {
      ctx.fillStyle = '#3a3a3c';
      ctx.fillRect(x, y, CW, CH);
      const s = Math.min(CW, CH) * 0.12;
      ctx.strokeStyle = '#aaa';
      ctx.lineWidth = Math.max(6, s * 0.18);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + CW / 2 - s, y + CH / 2); ctx.lineTo(x + CW / 2 + s, y + CH / 2);
      ctx.moveTo(x + CW / 2, y + CH / 2 - s); ctx.lineTo(x + CW / 2, y + CH / 2 + s);
      ctx.stroke();
    }
  }
  if (!forExport) { // プレビューだけに仕切り線を表示（書き出しには入らない）
    ctx.fillStyle = BG_PREVIEW;
    ctx.fillRect(OUT_W / 2 - 3, 0, 6, OUT_H);
    ctx.fillRect(0, OUT_H / 2 - 3, OUT_W, 6);
  }
}

// ===== 目元ぼかし =====
function blurEyes(img, m, x, y) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, CW, CH); ctx.clip();
  for (const e of img.eyes) {
    blurCircle(x + (e.x - m.sx) * m.r, y + (e.y - m.sy) * m.r, e.r * m.r * state.blurSize);
  }
  ctx.restore();
}

// 丸の中だけをぼかす（境界はくっきり）
function blurCircle(cx, cy, rad) {
  const size = Math.max(4, Math.round(rad * 2));
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = size;
  const t = tmp.getContext('2d');
  t.fillStyle = curBg; t.fillRect(0, 0, size, size);
  t.drawImage(canvas, cx - rad, cy - rad, rad * 2, rad * 2, 0, 0, size, size);

  const id = t.getImageData(0, 0, size, size);
  boxBlur(id.data, size, size, Math.max(2, Math.round(rad * 0.3)));
  t.putImageData(id, 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(tmp, cx - rad, cy - rad, rad * 2, rad * 2);
  ctx.restore();
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
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
      });
    });
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}

// 目ごとに [外側の目尻, 内側の目頭, 上まぶた, 下まぶた] のランドマーク番号
const EYE_IDX = [[33, 133, 159, 145], [263, 362, 386, 374]];

async function detectEyes(img, lm) {
  const s = Math.min(1, DETECT_MAX / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const res = lm.detect(c);
  const eyes = [];
  for (const face of res.faceLandmarks) {
    const P = (k) => ({ x: face[k].x * img.width, y: face[k].y * img.height });
    const list = EYE_IDX.map(([o, i, u, l]) => {
      const [po, pi, pu, pl] = [P(o), P(i), P(u), P(l)];
      const w = Math.hypot(po.x - pi.x, po.y - pi.y);
      const h = Math.hypot(pu.x - pl.x, pu.y - pl.y);
      return {
        x: (po.x + pi.x + pu.x + pl.x) / 4,
        y: (po.y + pi.y + pu.y + pl.y) / 4,
        w, r: Math.max(6, Math.max(w, h * 2) * 0.6),
      };
    });
    // 横顔判定：鼻先が「両目を結んだ線」の外側に出ていたら、その側の目は奥にあって見えない
    const nose = P(1);
    const dx = list[1].x - list[0].x, dy = list[1].y - list[0].y;
    const t = ((nose.x - list[0].x) * dx + (nose.y - list[0].y) * dy) / ((dx * dx + dy * dy) || 1);
    const maxW = Math.max(list[0].w, list[1].w);
    const kept = list.filter((e, k) => {
      const hiddenByNose = (k === 0 && t < 0.1) || (k === 1 && t > 0.9);
      const tooThin = e.w < maxW * 0.5; // 幅が極端に細い＝横を向いて奥側
      return !hiddenByNose && !tooThin;
    });
    if (!kept.length) kept.push(list[0].w >= list[1].w ? list[0] : list[1]); // 最低1つは残す
    kept.forEach((e) => eyes.push({ x: e.x, y: e.y, r: e.r }));
  }
  return eyes;
}

async function ensureEyes() {
  const targets = [...new Set(state.cells.filter((c) => c && (!c.img.eyes || c.img.autoFailed)).map((c) => c.img))];
  if (targets.length) {
    statusMsg = '目の検出中…（初回はモデル読み込みに数秒かかります）';
    renderStatus();
    let lm = null;
    try { lm = await getLandmarker(); }
    catch (err) {
      console.error(err);
      statusMsg = '目の自動検出を読み込めませんでした（ネット接続を確認してください）。下の表示から手動でぼかしを入れられます。';
    }
    for (const im of targets) {
      im.autoFailed = false;
      if (!lm) { im.eyes = []; im.autoFailed = true; continue; }
      try { im.eyes = await detectEyes(im, lm); }
      catch (err) { console.error(err); im.eyes = []; im.autoFailed = true; }
    }
    if (lm) statusMsg = '';
  }
  renderStatus();
  draw();
}

// ステータス＋「検出できなかった写真」の注意書き（タップで手動設定）
function renderStatus() {
  const box = $('status');
  box.textContent = '';
  if (statusMsg) { const p = document.createElement('p'); p.textContent = statusMsg; box.appendChild(p); }
  if (!state.blurOn) return;
  state.cells.forEach((c, i) => {
    if (c && c.img.eyes && c.img.eyes.length === 0) {
      const b = document.createElement('button');
      b.className = 'warn';
      b.textContent = `⚠ ${CELL_NAMES[i]}の写真：目を検出できませんでした。ここをタップして手動でぼかしを入れる`;
      b.onclick = () => openManual(i);
      box.appendChild(b);
    }
  });
  if (state.cells.some(Boolean)) { // 検出結果がずれている場合にも手動で直せる
    const row = document.createElement('div');
    row.className = 'manual-row';
    row.append('手動でぼかしを調整：');
    state.cells.forEach((c, i) => {
      if (!c) return;
      const b = document.createElement('button');
      b.textContent = CELL_NAMES[i];
      b.onclick = () => openManual(i);
      row.appendChild(b);
    });
    box.appendChild(row);
  }
}

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
const newCell = (img) => ({ img, zoom: 1, cx: img.width / 2, cy: img.height / 2 });

// ===== 拡大縮小・位置調整エディタ =====
const edCanvas = $('edCanvas');
const edCtx = edCanvas.getContext('2d');
edCanvas.width = 1280;
edCanvas.height = Math.round(1280 * CH / CW);
let ed = null;
const pointers = new Map();

function openEditor(i) {
  const c = state.cells[i];
  ed = { i, img: c.img, zoom: c.zoom, cx: c.cx, cy: c.cy };
  $('editor').hidden = false;
  syncZoomUI();
  drawEd();
}
function drawEd() {
  edCtx.fillStyle = '#000';
  edCtx.fillRect(0, 0, edCanvas.width, edCanvas.height);
  const m = drawImg(edCtx, ed.img, ed, 0, 0, edCanvas.width, edCanvas.height);
  ed.cx = m.sx + edCanvas.width / m.r / 2;
  ed.cy = m.sy + edCanvas.height / m.r / 2;
}
function syncZoomUI() {
  $('zoom').value = Math.round(ed.zoom * 100);
  $('zoomOut').textContent = Math.round(ed.zoom * 100) + '%';
}
function setZoom(z) { ed.zoom = clamp(z, 1, ZOOM_MAX); syncZoomUI(); drawEd(); }
function closeEditor() { $('editor').hidden = true; ed = null; pointers.clear(); }

$('zoom').oninput = (e) => setZoom(e.target.value / 100);
edCanvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(ed.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
edCanvas.addEventListener('pointerdown', (e) => {
  edCanvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
edCanvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !ed) return;
  const prev = pointers.get(e.pointerId);
  const k = edCanvas.width / edCanvas.getBoundingClientRect().width;
  if (pointers.size === 1) {
    const r = Math.max(edCanvas.width / ed.img.width, edCanvas.height / ed.img.height) * ed.zoom;
    ed.cx -= (e.clientX - prev.x) * k / r;
    ed.cy -= (e.clientY - prev.y) * k / r;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drawEd();
  } else if (pointers.size === 2) {
    const b = [...pointers.values()];
    const d0 = Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = [...pointers.values()];
    const d1 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    if (d0 > 0) setZoom(ed.zoom * d1 / d0);
  }
});
const endPointer = (e) => pointers.delete(e.pointerId);
edCanvas.addEventListener('pointerup', endPointer);
edCanvas.addEventListener('pointercancel', endPointer);

$('edCancel').onclick = closeEditor;
$('edSave').onclick = () => {
  const c = state.cells[ed.i];
  c.zoom = ed.zoom; c.cx = ed.cx; c.cy = ed.cy;
  closeEditor();
  draw();
};
$('edChange').onclick = () => { targetCell = ed.i; $('one').click(); };

// ===== 手動ぼかしエディタ =====
const mCanvas = $('mCanvas');
const mCtx = mCanvas.getContext('2d');
let man = null; // { i, img, circles:[{x,y,r}], sel }
let dragging = false;

function openManual(i) {
  const img = state.cells[i].img;
  man = { i, img, circles: (img.eyes || []).map((e) => ({ ...e })), sel: -1 };
  mCanvas.width = 1280;
  mCanvas.height = Math.round(1280 * img.height / img.width);
  $('manual').hidden = false;
  drawMan();
}
function drawMan() {
  mCtx.drawImage(man.img, 0, 0, mCanvas.width, mCanvas.height);
  const k = mCanvas.width / man.img.width;
  man.circles.forEach((e, idx) => {
    mCtx.beginPath();
    mCtx.arc(e.x * k, e.y * k, e.r * k, 0, Math.PI * 2);
    mCtx.lineWidth = idx === man.sel ? 6 : 3;
    mCtx.strokeStyle = idx === man.sel ? '#ffd60a' : '#ffffff';
    mCtx.stroke();
  });
}
const minSide = () => Math.min(man.img.width, man.img.height);
function mPoint(e) {
  const rect = mCanvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width * man.img.width,
           y: (e.clientY - rect.top) / rect.height * man.img.height };
}
mCanvas.addEventListener('pointerdown', (e) => {
  mCanvas.setPointerCapture(e.pointerId);
  const p = mPoint(e);
  let hit = -1;
  for (let i = man.circles.length - 1; i >= 0; i--) {
    const c = man.circles[i];
    if (Math.hypot(p.x - c.x, p.y - c.y) <= c.r * 1.3) { hit = i; break; }
  }
  if (hit < 0 && man.circles.length < MAX_MANUAL) {
    man.circles.push({ x: p.x, y: p.y, r: minSide() * 0.03 });
    hit = man.circles.length - 1;
  }
  man.sel = hit;
  dragging = hit >= 0;
  if (hit >= 0) $('mSize').value = Math.round(man.circles[hit].r / minSide() * 2000);
  drawMan();
});
mCanvas.addEventListener('pointermove', (e) => {
  if (!dragging || man.sel < 0) return;
  const p = mPoint(e);
  man.circles[man.sel].x = p.x; man.circles[man.sel].y = p.y;
  drawMan();
});
mCanvas.addEventListener('pointerup', () => { dragging = false; });
mCanvas.addEventListener('pointercancel', () => { dragging = false; });

$('mSize').oninput = (e) => {
  if (man.sel < 0) return;
  man.circles[man.sel].r = minSide() * e.target.value / 2000;
  drawMan();
};
$('mDelete').onclick = () => {
  if (man.sel < 0) return;
  man.circles.splice(man.sel, 1);
  man.sel = -1;
  drawMan();
};
$('mCancel').onclick = () => { $('manual').hidden = true; man = null; };
$('mDone').onclick = () => {
  man.img.eyes = man.circles.map((c) => ({ ...c }));
  man.img.autoFailed = false;
  $('manual').hidden = true;
  man = null;
  renderStatus();
  draw();
};

// ===== イベント =====
function updateHint() {
  $('hint').innerHTML = allFilled()
    ? '写真をタップすると別画面で拡大縮小・位置調整ができます<br>書き出しサイズ：3840×2160px（背景は黒）'
    : '＋をタップして写真を選択（4枚そろうと各写真の拡大縮小・位置調整ができます）<br>書き出しサイズ：3840×2160px';
}

$('blurOn').onchange = (e) => {
  state.blurOn = e.target.checked;
  $('blurSizeWrap').hidden = !state.blurOn;
  if (state.blurOn) ensureEyes(); else { statusMsg = ''; renderStatus(); draw(); }
};
$('blurSize').oninput = (e) => {
  state.blurSize = e.target.value / 100;
  $('blurSizeOut').textContent = e.target.value + '%';
  draw();
};

// マスをタップ：4枚そろうまでは写真選択、そろったら拡大縮小・位置調整
canvas.onclick = (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (OUT_W / rect.width);
  const py = (e.clientY - rect.top) * (OUT_H / rect.height);
  const i = (py >= CH ? 1 : 0) * COLS + (px >= CW ? 1 : 0);
  targetCell = i;
  if (allFilled()) openEditor(i); else $('one').click();
};

$('one').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || targetCell === null) return;
  state.cells[targetCell] = newCell(await loadImage(file));
  if (ed) { // 調整画面から「画像を変更」した場合
    const c = state.cells[targetCell];
    ed = { i: targetCell, img: c.img, zoom: 1, cx: c.cx, cy: c.cy };
    syncZoomUI(); drawEd();
  }
  updateHint();
  draw();
  if (state.blurOn) ensureEyes();
};

$('clear').onclick = () => {
  state.cells = [null, null, null, null];
  statusMsg = '';
  renderStatus(); updateHint(); draw();
};

// 保存：書き出し時は背景を黒にして自動ダウンロード
$('save').onclick = () => {
  draw(true);
  canvas.toBlob((blob) => {
    draw(false);
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

$('blurSizeOut').textContent = '100%';
if ($('ver')) $('ver').textContent = 'v' + VERSION;
updateHint();
draw();
