import { Brush } from './brush.js';
import { Paper } from './paper.js';
import { Player } from './player.js';
import { YONG_STROKES } from './strokes.js';
import { PenInput } from './input.js';

const stage = document.getElementById('stage');
const paperCanvas = document.getElementById('paperCanvas');
const inkCanvas = document.getElementById('inkCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');

let SIZE = 600;
let paper, brush, player, input;
const inkCtx = inkCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');

// 画布尺寸 = min(可用尺寸×0.94, 600)。brush 常量是绝对像素，600 是评估口径（沙箱 RSIZE），
// 大屏（iPad 13"）不再放大到 900+ 让笔宽相对变细。URL ?size=N 可覆盖（调试/对照用）。
const URL_SIZE = (() => {
  const v = parseInt(new URLSearchParams(location.search).get('size'), 10);
  return Number.isFinite(v) && v >= 100 && v <= 4096 ? v : 0;
})();
function targetSize() {
  if (URL_SIZE) return URL_SIZE;
  const rect = stage.getBoundingClientRect();
  return Math.min(600, Math.floor(Math.min(rect.width, rect.height) * 0.94));
}

function setup() {
  const size = targetSize();
  if (!size || size < 50) { setTimeout(setup, 250); return; } // 布局未就绪（如后台标签页），稍后重试
  SIZE = size;
  for (const c of [paperCanvas, inkCanvas, overlayCanvas]) {
    c.width = SIZE;
    c.height = SIZE;
    c.style.width = SIZE + 'px';
    c.style.height = SIZE + 'px';
  }
  paper = new Paper(SIZE);
  paper.absorb = parseFloat(ui.absorb.value);
  paper.drawBackground(paperCanvas.getContext('2d'), ui.showGrid.checked);

  brush = new Brush({
    size: parseFloat(ui.brushSize.value) * (SIZE / 600),
    stiffness: parseFloat(ui.stiffness.value),
    color: ui.inkColor.value,
    layerSize: SIZE,
  });

  player = new Player(brush, paper, inkCtx, drawOverlay);
  player.speed = parseFloat(ui.speed.value);
  player.onStrokeChange = showStrokeInfo;
  player.onDone = () => {
    setChipsActive(-1);
    ui.btnDemo.textContent = '▶ 书写「永」字';
    setTimeout(() => strokeInfo.classList.add('hidden'), 1500);
    overlayCtx.clearRect(0, 0, SIZE, SIZE); // 提笔离纸
    updateInkBar();
  };
}

// ---------- UI ----------
const ui = {
  btnDemo: document.getElementById('btnDemo'),
  btnDip: document.getElementById('btnDip'),
  btnClear: document.getElementById('btnClear'),
  speed: document.getElementById('speed'),
  brushSize: document.getElementById('brushSize'),
  stiffness: document.getElementById('stiffness'),
  inkColor: document.getElementById('inkColor'),
  absorb: document.getElementById('absorb'),
  showGrid: document.getElementById('showGrid'),
  basePressure: document.getElementById('basePressure'),
  inkFill: document.getElementById('inkFill'),
  chips: document.getElementById('strokeChips'),
  poseLink: document.getElementById('poseLink'),
  poseAlt0: document.getElementById('poseAlt0'),
  poseAlt0Val: document.getElementById('poseAlt0Val'),
  poseGain: document.getElementById('poseGain'),
  poseGainVal: document.getElementById('poseGainVal'),
  btnExportSamples: document.getElementById('btnExportSamples'),
  exportStatus: document.getElementById('exportStatus'),
  btnPanel: document.getElementById('btnPanel'),
  penHud: document.getElementById('penHud'),
};
const strokeInfo = document.getElementById('strokeInfo');
const strokeName = document.getElementById('strokeName');
const strokeTech = document.getElementById('strokeTech');

// 八法单笔回放按钮
YONG_STROKES.forEach((s, i) => {
  const b = document.createElement('button');
  b.textContent = s.name.split(' · ')[0];
  b.title = s.name;
  b.addEventListener('click', () => {
    if (!player || player.playing) return;
    input?.abort();                 // 手写进行中：先收笔，播放器才能接管 brush
    ui.btnDemo.textContent = '⏸ 书写中…';
    setChipsActive(i);
    player.playOne(i);
  });
  ui.chips.appendChild(b);
});

function setChipsActive(i) {
  [...ui.chips.children].forEach((c, j) => c.classList.toggle('active', i === j));
}

function showStrokeInfo(i, stroke) {
  setChipsActive(i);
  strokeName.textContent = stroke.name;
  strokeTech.textContent = stroke.tech;
  strokeInfo.classList.remove('hidden');
}

ui.btnDemo.addEventListener('click', () => {
  if (!player) return; // 画布尚未就绪
  if (player.playing) {
    player.stop();
    return;
  }
  input?.abort();                   // 手写进行中：先收笔，播放器才能接管 brush
  clearInk();
  ui.btnDemo.textContent = '⏸ 停止书写';
  player.playAll();
});

ui.btnDip.addEventListener('click', () => { brush?.dip(); updateInkBar(); });
// 清纸时若正在手写：先收笔再清，否则 brush._path 还在，下一个样本会把这一笔重画回来
ui.btnClear.addEventListener('click', () => { input?.abort(); clearInk(); });

ui.speed.addEventListener('input', () => { if (player) player.speed = parseFloat(ui.speed.value); });
ui.brushSize.addEventListener('input', () => {
  if (brush) brush.size = parseFloat(ui.brushSize.value) * (SIZE / 600);
});
ui.stiffness.addEventListener('input', () => {
  if (brush) brush.stiffness = parseFloat(ui.stiffness.value);
});
ui.inkColor.addEventListener('change', () => brush?.setColor(ui.inkColor.value));
ui.absorb.addEventListener('input', () => { if (paper) paper.absorb = parseFloat(ui.absorb.value); });
ui.showGrid.addEventListener('change', () => {
  paper?.drawBackground(paperCanvas.getContext('2d'), ui.showGrid.checked);
});

function clearInk() {
  inkCtx.clearRect(0, 0, SIZE, SIZE);
  overlayCtx.clearRect(0, 0, SIZE, SIZE);
  brush?.clearLayer();
}

function updateInkBar() {
  if (!brush) return;
  ui.inkFill.style.width = (brush.ink * 100).toFixed(0) + '%';
}
setInterval(updateInkBar, 300);

// ---------- 覆盖层：画出毛笔姿态 ----------
function drawOverlay() {
  overlayCtx.clearRect(0, 0, SIZE, SIZE);
  brush.renderPreview(overlayCtx); // 书写中的笔画未上纸，实时叠画在覆盖层
  const pose = brush.getPose();
  if (!pose.handle) return;

  const { handle, tip, pressure } = pose;
  const ctx = overlayCtx;

  // 笔杆（向右上方伸出，模拟执笔角度）
  ctx.strokeStyle = 'rgba(90, 60, 30, 0.85)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(handle.x, handle.y);
  ctx.lineTo(handle.x + 46, handle.y - 88);
  ctx.stroke();

  // 笔锋（从笔杆到锋尖的锥形）
  if (tip) {
    ctx.strokeStyle = pose.writing && pressure > 0.01
      ? 'rgba(40, 30, 25, 0.7)' : 'rgba(40, 30, 25, 0.35)';
    ctx.lineWidth = 2 + pressure * 6;
    ctx.beginPath();
    ctx.moveTo(handle.x, handle.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    // 锋尖
    ctx.fillStyle = 'rgba(176, 58, 46, 0.9)';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- 手写输入（js/input.js） ----------
// brush/paper 在 setup() 里会重建（resize），所以给 PenInput 的是 getter。
input = new PenInput(overlayCanvas, {
  brush: () => brush,
  paper: () => paper,
  inkCtx: () => inkCtx,
  busy: () => !player || player.playing,
  onFrame: () => { if (brush) { drawOverlay(); updateInkBar(); } },
  basePressure: () => parseFloat(ui.basePressure.value),
  poseOn: () => ui.poseLink.checked,
  alt0Deg: () => parseFloat(ui.poseAlt0.value),
  gain: () => parseFloat(ui.poseGain.value),
  hud: ui.penHud,
});

const showPoseVals = () => {
  ui.poseAlt0Val.textContent = parseFloat(ui.poseAlt0.value).toFixed(0) + '°';
  ui.poseGainVal.textContent = parseFloat(ui.poseGain.value).toFixed(1);
};
ui.poseAlt0.addEventListener('input', showPoseVals);
ui.poseGain.addEventListener('input', showPoseVals);
showPoseVals();

// 导出手写样本 → POST /save-json（端点由 server.js 提供；旧进程未重启时 404，提示即可）
ui.btnExportSamples.addEventListener('click', async () => {
  const st = ui.exportStatus;
  const n = input.strokes.length;
  if (!n) { st.className = 'status err'; st.textContent = '还没有录到笔画'; return; }
  st.className = 'status'; st.textContent = `上传 ${n} 笔…`;
  ui.btnExportSamples.disabled = true;
  try {
    const r = await input.exportToServer('pen-samples');
    if (r.ok) { st.className = 'status ok'; st.textContent = `已存 ${r.text}（${n} 笔，${(r.bytes / 1024).toFixed(0)} KB）`; }
    else if (r.status === 404) { st.className = 'status err'; st.textContent = '服务器无 /save-json：请重启 node server.js 后再试（JSON 已打印到控制台）'; console.log('[bimo] pen samples', input.export()); }
    else if (r.status === 0) { st.className = 'status err'; st.textContent = '网络错误：' + r.text; }
    else { st.className = 'status err'; st.textContent = `HTTP ${r.status}: ${r.text}`; }
  } finally {
    ui.btnExportSamples.disabled = false;
  }
});

// 面板折叠：iPad 上腾出书写空间。布局变化后按新可用尺寸重排（尺寸没变则不动画布）
ui.btnPanel.addEventListener('click', () => {
  document.getElementById('app').classList.toggle('panel-hidden');
  relayout();
});

// ---------- 启动 ----------
setup();

// 调试钩子：供自动化验证脚本直接驱动毛笔（不影响正常使用）
window.__bimo = {
  get brush() { return brush; },
  get player() { return player; },
  get paper() { return paper; },
  get inkCtx() { return inkCtx; },
  get input() { return input; },
  drawOverlay,
};

function relayout() {
  const newSize = targetSize();
  if (!newSize || newSize === SIZE) return; // 面板显隐切换等假 resize，不动画布
  input?.abort();                           // 手写进行中：先收笔落墨，再重建 brush（否则这一笔静默丢失）
  if (player?.playing) player.stop();

  // 尺寸真变了：把已写的墨迹按比例搬到新画布，保留笔中墨量
  const old = document.createElement('canvas');
  old.width = old.height = SIZE;
  old.getContext('2d').drawImage(inkCanvas, 0, 0);
  const oldInk = brush?.ink ?? 1;

  setup();
  brush.ink = oldInk;
  inkCtx.drawImage(old, 0, 0, SIZE, SIZE);
  updateInkBar();
}
window.addEventListener('resize', relayout);
