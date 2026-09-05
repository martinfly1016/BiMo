// 毛笔渲染模型 v3 —— 脊线变宽缎带（spine-ribbon）
//
// 为什么不再用"凸泪滴接触斑的并集"：书法笔画处处是内凹边、不对称边、方棱缺口、
// 尖针出锋（见视频真迹逐笔特写诊断）。凸形状的并集在拓扑上只能得到凸包络，
// 永远做不出这些——这是细节上不去的根源。
//
// v3 做法：一笔 = 一条脊线(中轴) + 沿线变化的左右两条独立边。
//   move() 沿路径记录采样点 {x, y, 左半宽 wl, 右半宽 wr}；
//   end() 把左边缘(正向) + 右边缘(逆向)接成闭合多边形填充。
// 由此可得：
//   · 尖针出锋 —— 端点半宽→0，两边自然合拢成尖
//   · 内凹腰身 —— 某处半宽局部变小(压力谷)，边缘凹进去
//   · 不对称 —— wl ≠ wr，一边直一边凸/凹
//   · 方棱 —— 端点切平（cap）
// 半宽由压力给出（node.p），另可由 node.wl/wr 或 node.asym(侧偏) 精细控制。
// 软边墨感合成 _composite 保留：模糊墨晕柔化边缘 + 清晰主体。
// 目标是"设计出的好书法"，脊线直接用节点路径，不做 stick-slip 锋尖动力学（换可控性）。

export const INK_COLORS = {
  red:   { r: 198, g: 52,  b: 28 },   // 朱砂红（按真迹墨核采样 ~(200,55,30) 校准，旧值 178,34,22 偏暗沉）
  black: { r: 24,  g: 20,  b: 18 },
};

export class Brush {
  constructor(opts = {}) {
    this.size = opts.size ?? 22;             // 笔号：满压时的半宽上限尺度
    this.stiffness = opts.stiffness ?? 0.45;
    this.color = INK_COLORS[opts.color ?? 'red'];
    this.ink = 1;
    this.inkCapacity = 120;

    this.strokeCanvas = null;
    this.strokeCtx = null;
    if (opts.layerSize) this.initLayer(opts.layerSize);
    this.reset();
  }

  initLayer(size) {
    this.strokeCanvas = document.createElement('canvas');
    this.strokeCanvas.width = this.strokeCanvas.height = size;
    this.strokeCtx = this.strokeCanvas.getContext('2d');
  }
  clearLayer() {
    if (this.strokeCtx) this.strokeCtx.clearRect(0, 0, this.strokeCanvas.width, this.strokeCanvas.height);
  }

  reset() {
    this.handle = null;
    this.tip = null;
    this.pressure = 0;
    this.velocity = 0;
    this.writing = false;
    this._path = [];       // 脊线采样 {x, y, p, wl, wr}
    this._strokeInk = 1;
    this._inkCtx = null;
  }

  dip() { this.ink = 1; }
  setColor(name) { this.color = INK_COLORS[name] ?? this.color; }

  // 压力 → 半宽尺度（0..~1.15，乘 size）。系数 1.01 按真迹面积比校准
  // （2026-07-04 掩膜口径含深色积墨边缘带后重校；旧口径 0.95）
  _halfW(p) {
    if (p <= 0.004) return 0;
    return this.size * Math.min(1.15, 1.01 * Math.pow(p, 0.82));
  }

  // 落笔。butt 非假时起端不补圆头帽——保留切平端面（切锋起笔的刃口）；
  // butt 为数字时 = 端面绕脊点旋转的角度（度，正=顺时针）——笔锋斜置切入的刃口斜角
  begin(x, y, pressure = 0, butt = false) {
    this.handle = { x, y };
    this.tip = { x, y };
    this.pressure = pressure;
    this.velocity = 0;
    this.writing = true;
    this._buttStart = !!butt;
    this._buttAngle = typeof butt === 'number' ? butt * Math.PI / 180 : 0;
    this._strokeInk = this.ink;
    this._noiseSeed = ((this._strokeCount = (this._strokeCount || 0) + 1) * 7.13) % 100; // 每笔一味，重建间稳定
    const hw = this._halfW(pressure);
    this._path = [{ x, y, p: pressure, wl: hw, wr: hw, v: 0 }];   // 起笔落纸视为慢速（积墨重）
    this.clearLayer();
  }

  // 行笔：脊线记录 (x,y)，压力 p。node 可携带 wl/wr(显式左右半宽比例) 或 asym(侧偏 -1..1)。
  // speed 仅用于耗墨/预留。opts = { wlk, wrk, asym }（当前节点的形状控制，可选）
  move(x, y, p, ctx, paper, speed = 200, opts = null) {
    if (!this.writing) return;
    this._inkCtx = ctx;
    this.velocity += (speed - this.velocity) * 0.25;
    const h = this.handle;
    const dx = x - h.x, dy = y - h.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 2));
    const p0 = this.pressure;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = h.x + dx * t, py = h.y + dy * t;
      const pr = p0 + (p - p0) * t;
      const hw = this._halfW(pr);
      let wl = hw, wr = hw;
      if (opts) {
        if (opts.wlk != null) wl = hw * opts.wlk;
        if (opts.wrk != null) wr = hw * opts.wrk;
        if (opts.asym) { const s = hw * opts.asym; wl = hw + s; wr = hw - s; }
      }
      const last = this._path[this._path.length - 1];
      if (last && Math.hypot(px - last.x, py - last.y) < 0.6) {
        // 驻笔/原地：不新增退化点，只把该点更新为更大的半宽（顿笔加粗）
        if (wl > last.wl) last.wl = wl;
        if (wr > last.wr) last.wr = wr;
        last.p = pr;
        last.v = Math.min(last.v, speed);   // 驻笔记为慢速（积墨更重）
      } else {
        this._path.push({ x: px, y: py, p: pr, wl, wr, v: speed });
      }
      const swept = 2 * hw * (dist / steps);
      this.ink = Math.max(0, this.ink - swept / (this.size * this.size) / this.inkCapacity);
    }
    this.handle = { x, y };
    this.tip = { x, y };
    this.pressure = p;
    this._rebuild();
  }

  end() {
    if (this.writing) {
      this._rebuild();
      if (this._inkCtx && this.strokeCanvas) {
        this._composite(this._inkCtx, true);   // 收笔落墨：叠加积墨沉淀层
        this.clearLayer();
      }
    }
    this.writing = false;
    this.pressure = 0;
  }

  // 由脊线路径构建缎带轮廓，填入笔画图层（实心，合成时再上色/软边）
  _rebuild() {
    const sc = this.strokeCtx;
    if (!sc) return;
    this.clearLayer();
    const P = this._path;
    if (P.length < 2) return;

    // 平滑压力/半宽，避免采样抖动造成边缘毛刺（保留大的粗细起伏）
    const n = P.length;
    const wl = new Float64Array(n), wr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[Math.min(n - 1, i + 1)];
      wl[i] = a.wl * 0.25 + b.wl * 0.5 + c.wl * 0.25;
      wr[i] = a.wr * 0.25 + b.wr * 0.5 + c.wr * 0.25;
    }

    // 手写噪声（确定性，按弧长索引，重建间稳定不闪烁）：
    //   低频 = 行笔提按微波动（真迹掠身有 ±3~5% 的节奏起伏）
    //   高频 = 边缘台阶毛糙（真迹起笔上缘是短直线拼接、带 1-2px 凹凸）
    //   左右相位独立 → 两缘不对称；尖端处噪声归零，保证针尖干净
    const seed = this._noiseSeed;
    const h1 = (i) => { const s = Math.sin(i * 12.9898 + seed) * 43758.5453; return s - Math.floor(s); };
    const vn = (x) => { const i0 = Math.floor(x), f = x - i0, u = f * f * (3 - 2 * f); return h1(i0) * (1 - u) + h1(i0 + 1) * u; };
    for (let i = 0; i < n; i++) {
      const lf = vn(i / 26) - 0.5;
      const hfL = vn(i / 4 + 77.7) - 0.5;
      const hfR = vn(i / 4 + 191.3) - 0.5;
      // 尖端门控（宽度小→无噪）× 头部门控（起笔是刻意动作，边缘利落如刀切；行笔渐入自然波动）
      // 高频幅度压低：真迹含墨充足时长弧边缘光洁绷紧（"松"的边缘失张力）
      const g = Math.min(1, (wl[i] + wr[i]) / 6) * Math.min(1, i / 15);
      wl[i] = Math.max(0, wl[i] * (1 + 0.04 * lf * g + 0.01 * hfL * g) + 0.09 * hfL * g);
      wr[i] = Math.max(0, wr[i] * (1 + 0.04 * lf * g + 0.01 * hfR * g) + 0.09 * hfR * g);
    }

    // 逐点法线（中心差分切线的垂直方向）+ 切向角
    const nx = new Float64Array(n), ny = new Float64Array(n), th = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      nx[i] = -ty; ny[i] = tx;   // 法线 = 切线逆时针 90°
      th[i] = Math.atan2(ty, tx);
    }
    // 切锋刃口斜角：头部一段法线渐进旋转（P[0] 全量 → 第 K 点归零）。
    // 只转首点会与 2px 外的邻点扭出自交四边形；渐进 = 笔锋斜置切入后行笔中逐渐摆正。
    if (this._buttStart && this._buttAngle) {
      const K = Math.min(8, n - 1);
      for (let i = 0; i < K; i++) {
        const ang = this._buttAngle * (1 - i / K);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const rx = nx[i] * ca - ny[i] * sa, ry = nx[i] * sa + ny[i] * ca;
        nx[i] = rx; ny[i] = ry;
      }
    }

    // 四边形条带并集：每段一个小四边形独立填充（左右边顶点按设计半宽偏移）。
    // 相邻/折返区域只是不透明重涂——无 winding 抵消、无洞；
    // 凹口由左/右缘顶点序列天然保留（这才是"墨迹随时间并集"的正确离散化）。
    const c = this.color;
    sc.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
    sc.strokeStyle = sc.fillStyle;
    sc.lineWidth = 0.6;   // 盖住相邻四边形间的抗锯齿细缝
    sc.lineJoin = 'round';
    const lx = new Float64Array(n), ly = new Float64Array(n), rx = new Float64Array(n), ry = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      lx[i] = P[i].x + nx[i] * wl[i]; ly[i] = P[i].y + ny[i] * wl[i];
      rx[i] = P[i].x - nx[i] * wr[i]; ry[i] = P[i].y - ny[i] * wr[i];
    }
    for (let i = 0; i < n - 1; i++) {
      if (wl[i] + wr[i] < 0.05 && wl[i+1] + wr[i+1] < 0.05) continue;
      sc.beginPath();
      sc.moveTo(lx[i], ly[i]);
      sc.lineTo(lx[i+1], ly[i+1]);
      sc.lineTo(rx[i+1], ry[i+1]);
      sc.lineTo(rx[i], ry[i]);
      sc.closePath();
      sc.fill();
      sc.stroke();
    }

    // 端点若非尖（半宽较大，如顿笔收尾）补一个圆头 cap，避免生硬平切
    this._cap(sc, P[0], nx[0], ny[0], wl[0], wr[0], true);
    this._cap(sc, P[n - 1], nx[n - 1], ny[n - 1], wl[n - 1], wr[n - 1], false);

    // 收集顿笔积墨斑：慢行/驻笔区间的中心与当地宽度（收笔时以径向软斑叠加——
    // 真迹顿笔处是一团沉下去的深墨，不是一段粗描边）
    this._dwellSpots = [];
    let run = null;
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let d = -2; d <= 2; d++) { const j = i + d; if (j >= 0 && j < n) { s += P[j].v ?? 200; c++; } }
      const slow = 1.2 - (s / c) / 350;
      if (slow > 0.72 && wl[i] + wr[i] > 4) {
        if (!run) run = { i0: i };
        run.i1 = i;
      } else if (run) {
        const mid = (run.i0 + run.i1) >> 1;
        this._dwellSpots.push({ x: P[mid].x, y: P[mid].y, r: (wl[mid] + wr[mid]) * 0.85 });
        run = null;
      }
    }
    if (run) {
      const mid = (run.i0 + run.i1) >> 1;
      this._dwellSpots.push({ x: P[mid].x, y: P[mid].y, r: (wl[mid] + wr[mid]) * 0.85 });
    }
  }

  _cap(sc, pt, nxi, nyi, wl, wr, isStart) {
    if (isStart && this._buttStart) return;   // 切面起笔：端面即轮廓，保留双棱
    const w = Math.max(wl, wr);
    if (w < this.size * 0.12) return;   // 已经收成尖，不补
    const cx = pt.x + nxi * (wl - wr) * 0.5;
    const cy = pt.y + nyi * (wl - wr) * 0.5;
    sc.beginPath();
    sc.arc(cx, cy, (wl + wr) * 0.5, 0, Math.PI * 2);
    sc.fill();
  }

  _tone() { return Math.min(0.92, 0.62 + 0.3 * (this._strokeInk ?? 1)); }

  // 积墨层：内边缘渐变（"外部深色 blur 渗入形状内缘"再裁回形状——从边向内自然衰减，
  // 无描边分界线）+ 顿笔径向软斑。收笔时才合成——墨沉淀的时序，也免去书写中每帧 blur。
  _inkDeposit() {
    const sc = this.strokeCanvas, S = sc.width;
    if (!this._dep1 || this._dep1.width !== S) {
      this._dep1 = document.createElement('canvas'); this._dep1.width = this._dep1.height = S;
      this._dep2 = document.createElement('canvas'); this._dep2.width = this._dep2.height = S;
    }
    const d1 = this._dep1.getContext('2d');
    d1.clearRect(0, 0, S, S);
    d1.globalCompositeOperation = 'source-over';
    d1.fillStyle = 'rgb(150,32,20)';
    d1.fillRect(0, 0, S, S);
    d1.globalCompositeOperation = 'destination-out';   // 镂空笔画 → 只剩外部深色
    d1.drawImage(sc, 0, 0);
    d1.globalCompositeOperation = 'source-over';
    const d2 = this._dep2.getContext('2d');
    d2.clearRect(0, 0, S, S);
    const bl = Math.max(1.2, this.size * 0.085);
    if (d2.filter !== undefined) d2.filter = `blur(${bl.toFixed(2)}px)`;
    d2.drawImage(this._dep1, 0, 0);                    // 外部深色渗入边缘
    if (d2.filter !== undefined) d2.filter = 'none';
    // 顿笔积墨斑（在裁剪前画，随后一起裁回形状内）
    for (const sp of this._dwellSpots ?? []) {
      const g = d2.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sp.r);
      g.addColorStop(0, 'rgba(150,32,20,0.34)');
      g.addColorStop(1, 'rgba(150,32,20,0)');
      d2.fillStyle = g;
      d2.beginPath(); d2.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2); d2.fill();
    }
    d2.globalCompositeOperation = 'destination-in';    // 裁回笔画形状内
    d2.drawImage(sc, 0, 0);
    d2.globalCompositeOperation = 'source-over';
    return this._dep2;
  }

  // 墨感合成：模糊墨晕柔化边缘 + 清晰主体；final=true（收笔落墨）时叠加积墨沉淀层。
  // 主体区域先抠除底墨再落墨——纸上墨浓度物理饱和，两笔交叠不加深（后笔盖前笔），
  // 消除 alpha 叠加的"透痕"接缝。
  _composite(ctx, final = false) {
    const sc = this.strokeCanvas;
    const tone = this._tone();
    const blurPx = Math.max(0.5, this.size * 0.032);
    ctx.save();
    // 快照本笔落墨前的纸面（用于屏蔽交叠区的伪积墨边——交叠界内是墨内部，不是墨缘）
    let prevInk = null;
    if (final) {
      if (!this._prevCvs || this._prevCvs.width !== ctx.canvas.width) {
        this._prevCvs = document.createElement('canvas');
        this._prevCvs.width = ctx.canvas.width; this._prevCvs.height = ctx.canvas.height;
      }
      const pc = this._prevCvs.getContext('2d');
      pc.clearRect(0, 0, this._prevCvs.width, this._prevCvs.height);
      pc.drawImage(ctx.canvas, 0, 0);
      prevInk = this._prevCvs;
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.drawImage(sc, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (ctx.filter !== undefined) {
      ctx.globalAlpha = tone * 0.18;
      ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
      ctx.drawImage(sc, 0, 0);
      ctx.filter = 'none';
    }
    ctx.globalAlpha = tone;
    ctx.drawImage(sc, 0, 0);
    if (final) {
      const dep = this._inkDeposit();
      if (prevInk) {
        const dc = dep.getContext('2d');
        dc.globalCompositeOperation = 'destination-out';
        dc.globalAlpha = 1;
        dc.drawImage(prevInk, 0, 0);
        dc.globalCompositeOperation = 'source-over';
        dc.globalAlpha = 1;
      }
      ctx.globalAlpha = tone * 0.9;
      ctx.drawImage(dep, 0, 0);
    }
    ctx.restore();
  }

  renderPreview(ctx) {
    if (this.writing && this.strokeCanvas) this._composite(ctx);
  }

  getPose() {
    return {
      handle: this.handle,
      tip: this.tip,
      pressure: this.pressure,
      writing: this.writing,
      size: this.size,
    };
  }
}
