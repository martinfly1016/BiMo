import { Brush } from './brush.js';
import { Paper } from './paper.js';
import { Player } from './player.js';
import { YONG_STROKES } from './strokes.js';

const stage = document.getElementById('stage');
const paperCanvas = document.getElementById('paperCanvas');
const inkCanvas = document.getElementById('inkCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');

let SIZE = 600;
let paper, brush, player;
const inkCtx = inkCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');

function setup() {
  const rect = stage.getBoundingClientRect();
  const size = Math.floor(Math.min(rect.width, rect.height) * 0.94);
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
  clearInk();
  ui.btnDemo.textContent = '⏸ 停止书写';
  player.playAll();
});

ui.btnDip.addEventListener('click', () => { brush?.dip(); updateInkBar(); });
ui.btnClear.addEventListener('click', clearInk);

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

// ---------- 手写输入 ----------
let drawing = false;
let lastPointer = null;

overlayCanvas.addEventListener('pointerdown', e => {
  if (!player || player.playing) return;
  overlayCanvas.setPointerCapture(e.pointerId);
  drawing = true;
  const pos = eventPos(e);
  lastPointer = { ...pos, t: e.timeStamp };
  brush.begin(pos.x, pos.y, pointerPressure(e, 0));
});

overlayCanvas.addEventListener('pointermove', e => {
  if (!drawing) return;
  const pos = eventPos(e);
  const dt = Math.max(1, e.timeStamp - lastPointer.t);
  const speed = Math.hypot(pos.x - lastPointer.x, pos.y - lastPointer.y) / dt; // px/ms
  brush.move(pos.x, pos.y, pointerPressure(e, speed), inkCtx, paper, speed * 1000);
  lastPointer = { ...pos, t: e.timeStamp };
  drawOverlay();
  updateInkBar();
});

const endStroke = e => {
  if (!drawing) return;
  drawing = false;
  brush.end();
  drawOverlay();
};
overlayCanvas.addEventListener('pointerup', endStroke);
overlayCanvas.addEventListener('pointercancel', endStroke);

function eventPos(e) {
  const r = overlayCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// 触控笔用真实压感；鼠标用"运笔快慢"模拟提按：慢按则重，快提则轻
function pointerPressure(e, speed) {
  if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure;
  const base = parseFloat(ui.basePressure.value);
  const speedLift = Math.min(0.75, speed * 0.55);
  return Math.max(0.05, base - speedLift);
}

// ---------- 启动 ----------
setup();

// 调试钩子：供自动化验证脚本直接驱动毛笔（不影响正常使用）
window.__bimo = {
  get brush() { return brush; },
  get player() { return player; },
  get paper() { return paper; },
  get inkCtx() { return inkCtx; },
  drawOverlay,
};
window.addEventListener('resize', () => {
  const rect = stage.getBoundingClientRect();
  const newSize = Math.floor(Math.min(rect.width, rect.height) * 0.94);
  if (!newSize || newSize === SIZE) return; // 面板显隐切换等假 resize，不动画布
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
});
