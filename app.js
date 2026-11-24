// ===== 設定：レイアウトを増やすにはここに1行足すだけ =====
const LAYOUTS = [
  { id: '2x2', label: '2×2（4枚）', cols: 2, rows: 2 },
  { id: '1x2', label: '縦2枚',     cols: 1, rows: 2 },
  { id: '2x1', label: '横2枚',     cols: 2, rows: 1 },
  { id: '2x3', label: '2×3（6枚）', cols: 2, rows: 3 },
  { id: '3x3', label: '3×3（9枚）', cols: 3, rows: 3 },
];
const OUTPUT_WIDTH = 1080;   // 出力画像の幅(px)
const CAPTION_HEIGHT = 110;  // キャプション領域の高さ(px)

// ===== 状態 =====
const state = { layout: LAYOUTS[0], images: [], gap: 8, bg: '#ffffff', caption: '' };
let targetCell = null; // 差し替え対象のマス番号

// ===== 要素 =====
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

// ===== 描画 =====
function geometry() {
  const { cols, rows } = state.layout;
  const g = state.gap;
  const cell = (OUTPUT_WIDTH - g * (cols + 1)) / cols;
  const capH = state.caption ? CAPTION_HEIGHT : 0;
  const h = g * (rows + 1) + cell * rows + capH;
  return { cols, rows, g, cell, capH, h };
}

function draw() {
  const { cols, rows, g, cell, capH, h } = geometry();
  canvas.width = OUTPUT_WIDTH;
  canvas.height = Math.round(h);
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < cols * rows; i++) {
    const x = g + (i % cols) * (cell + g);
    const y = g + Math.floor(i / cols) * (cell + g);
    const img = state.images[i];
    if (img) {
      drawCover(img, x, y, cell, cell);
    } else {
      ctx.fillStyle = 'rgba(128,128,128,.25)';
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = 'rgba(128,128,128,.8)';
      ctx.font = `${cell * 0.25}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', x + cell / 2, y + cell / 2);
    }
  }

  if (state.caption) {
    ctx.fillStyle = isDark(state.bg) ? '#fff' : '#222';
    ctx.font = 'bold 44px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.caption, canvas.width / 2, canvas.height - capH / 2 - g / 2, canvas.width - 60);
  }
}

// 枠いっぱいに中央トリミングして描画
function drawCover(img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum < 128;
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

// ===== イベント =====
LAYOUTS.forEach((l, i) => $('layout').add(new Option(l.label, i)));

$('layout').onchange = (e) => { state.layout = LAYOUTS[e.target.value]; draw(); };
$('gap').oninput = (e) => { state.gap = +e.target.value; $('gapOut').textContent = state.gap + 'px'; draw(); };
$('bg').oninput = (e) => { state.bg = e.target.value; draw(); };
$('caption').oninput = (e) => { state.caption = e.target.value; draw(); };

$('pick').onclick = () => $('files').click();
$('files').onchange = async (e) => {
  const imgs = await Promise.all([...e.target.files].map(loadImage));
  const total = state.layout.cols * state.layout.rows;
  state.images = imgs.slice(0, total);
  e.target.value = '';
  draw();
};

// マスをタップ → その1枚だけ差し替え
canvas.onclick = (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  const { cols, rows, g, cell } = geometry();
  const col = Math.floor((px - g / 2) / (cell + g));
  const row = Math.floor((py - g / 2) / (cell + g));
  if (col < 0 || col >= cols || row < 0 || row >= rows) return;
  targetCell = row * cols + col;
  $('one').click();
};
$('one').onchange = async (e) => {
  if (e.target.files[0] && targetCell !== null) {
    state.images[targetCell] = await loadImage(e.target.files[0]);
    draw();
  }
  e.target.value = '';
};

$('clear').onclick = () => { state.images = []; draw(); };

$('save').onclick = () => {
  canvas.toBlob(async (blob) => {
    const file = new File([blob], 'collage.png', { type: 'image/png' });
    // スマホは共有シート（写真に保存など）、PCは通常ダウンロード
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (_) { /* キャンセル時は何もしない */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'collage.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
};

$('gapOut').textContent = state.gap + 'px';
draw();
