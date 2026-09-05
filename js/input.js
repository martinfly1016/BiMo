// 手写输入层：Apple Pencil / 鼠标 → 毛笔（从 main.js 迁出并扩展）
//
// 职责
//   · 指针过滤：只有 'pen' 与 'mouse' 落墨；'touch' 一律忽略并 preventDefault（防手掌）。
//     书写中按 pointerId 独占——第二个指针的 down/move/up 全部忽略，当前笔不被打断。
//     恢复路径（防 active 卡死）：同一 pointerId 再次 down（上次 up 丢了）先收上一笔再开新笔；
//     别的指针 down 时若当前笔已 >STALE_MS 无样本则视为失效先收掉；window 级 pointerup/
//     pointercancel（capture 失败、画布外松开）、window blur、document hidden 都会收笔。
//   · 合并样本：pointermove 用 getCoalescedEvents() 展开逐样本喂 brush.move
//     （合成/untrusted 事件上它返回空数组 → 回退 [e]）。
//   · 速度：速度锚点——锚点到当前样本 ≥SPEED_DT_MS 才重算（段平均）并把锚点移到当前样本，
//     否则沿用上一次。合并样本时间戳相同/近似时仍得到正确的整段平均速度（而不是「1/4 段
//     位移 ÷ 整帧时间」的 4× 低估——brush.js 用 speed 判驻笔积墨，低估会处处出积墨斑）。
//   · 姿态：altitudeAngle/azimuthAngle（弧度）优先；缺则由 tiltX/tiltY 换算；都缺视为垂直。
//   · 姿态直连（可开关）：侧锋量 m 与 s=dot(ℓ,n) 连续决定左右半宽比 wlk/wrk（只传 wlk/wrk，
//     绝不传 asym——brush.js:106 的 asym 会整体覆盖 wlk/wrk），起笔延迟 2~3 个样本拿到行笔
//     方向后再 begin，侧锋切入时以 n→ℓ 夹角的连续函数作 butt 刃口斜角（见 poseShape）。
//   · 起笔压力：pen 首样本压力常为 0（iPad Safari 首个 pointerdown）。begin 用缓存里第一个
//     p>BEGIN_P_MIN_REAL 的样本压力（没有则用缓存最大 p，全为 0 则 MIN_BEGIN_P）；只有 begun
//     之后的 0 压力才是离纸尾巴 0.004（_halfW 归零成针尖）。
//   · 原始样本录制 {x,y,p,alt,az,t,type}（画布坐标，p 为传感器原值），export() 生成 JSON。
//   · HUD：DOM 元素（不画在 overlay 上，drawOverlay 每帧 clearRect）。
//   · abort()：外部在接管 brush 之前调用（播放器启动、relayout 重建 brush、清纸），收掉进行中的
//     手写笔并归档录制。busy() 中途变真（播放器已 begin 了同一支 brush）时手写笔被丢弃、不碰 brush。
//
// 坐标/符号约定（与 brush.js 一致）
//   画布 y 向下。行笔切线 t=(tx,ty)，法线 n=(-ty,tx)（切线逆时针 90°）；
//   左缘 = P + n·wl，右缘 = P − n·wr。向右行时 wl=下缘、wr=上缘；向下行时 wl=左缘、wr=右缘。
//   azimuthAngle：0 指 +x（屏幕右），顺时针增加，π/2 指 +y（屏幕下）——是笔杆（笔尾）在纸面的投影方向。
//   毫束倒向 ℓ = −(cos az, sin az)：从笔腹指向锋尖（锋尖在笔杆的反方向）。锋尖侧薄、笔腹侧厚。
//   验收：右手常规握姿（笔杆倒向右下，az≈π/4..π/2）向右写横 → ℓ 朝上/左上 → 锋尖在上缘 → 上缘薄。

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

export const MIN_BEGIN_P = 0.15;       // 缓存样本压力全为 0 时的最小起笔压力
export const BEGIN_P_MIN_REAL = 0.02;  // 视为「真实读数」的最小压力（以下当作传感器未就绪）
export const SPEED_DT_MS = 4;          // 速度锚点最小时间跨度
export const STALE_MS = 3000;          // 当前笔多久无样本视为失效（别的指针落下时可顶替）
export const BUTT_MAX_DEG = 45;        // 刃口斜角峰值
export const BUTT_M_GATE = 0.15;       // 侧锋量门限：以上才用平切/刃口端面（以下圆头帽）

// Pointer Events 规范里的 tilt → altitude/azimuth 换算：
//   tiltX/tiltY 是笔杆在 x-z / y-z 平面内与 z 轴的夹角（度）。
//   az  = atan2(tan(tiltY), tan(tiltX))，负值加 2π；tiltX=tiltY=0 时 az=0
//   alt = atan( 1 / sqrt(tan²(tiltX) + tan²(tiltY)) )；任一 |tilt|=90° 时 alt=0；两者为 0 时 alt=π/2
export function tiltToPose(tiltX, tiltY) {
  if (!tiltX && !tiltY) return { alt: Math.PI / 2, az: 0 };
  const tx = tiltX * RAD, ty = tiltY * RAD;
  let az;
  if (tiltX === 0) az = tiltY > 0 ? Math.PI / 2 : 3 * Math.PI / 2;
  else if (tiltY === 0) az = tiltX > 0 ? 0 : Math.PI;
  else { az = Math.atan2(Math.tan(ty), Math.tan(tx)); if (az < 0) az += TAU; }
  let alt;
  if (Math.abs(tiltX) >= 90 || Math.abs(tiltY) >= 90) alt = 0;
  else alt = Math.atan(1 / Math.sqrt(Math.tan(tx) ** 2 + Math.tan(ty) ** 2));
  return { alt, az };
}

// 姿态回退链：alt/az → tilt → 垂直。返回 { alt, az, src }（src: 'alt' | 'tilt' | 'none'）
export function poseOf(s) {
  const a = s.altitudeAngle, z = s.azimuthAngle;
  if (typeof a === 'number' && typeof z === 'number' && !Number.isNaN(a) && !Number.isNaN(z)) {
    return { alt: a, az: z, src: 'alt' };
  }
  if (typeof s.tiltX === 'number' && typeof s.tiltY === 'number' && !Number.isNaN(s.tiltX) && !Number.isNaN(s.tiltY)) {
    const p = tiltToPose(s.tiltX, s.tiltY);
    return { alt: p.alt, az: p.az, src: 'tilt' };
  }
  return { alt: Math.PI / 2, az: 0, src: 'none' };
}

// 侧锋量 m = clamp01( gain · max(0, cos(alt) − cos(alt0)) )
export function sideAmount(alt, alt0Rad, gain) {
  return Math.max(0, Math.min(1, gain * Math.max(0, Math.cos(alt) - Math.cos(alt0Rad))));
}

// 姿态 + 行笔方向 → 缎带形状参数。dir 为单位切线 {x,y} 或 null（方向未知 → 对称、无刃口）。
// 返回 { m, s, wlk, wrk, butt, tipSide }，tipSide: -1 = 锋尖在左(wl)侧，+1 = 在右(wr)侧，0 = 居中/未知。
//
// 所有输出都是 az 的连续函数——ℓ∥n（φ=0）与 ℓ∥t（φ=±90°）两个边界都不是阶跃。后者不是罕见
// 姿态：右手 az≈45° 写捺（t=(1,1)/√2）、az≈90° 写竖（t=(0,1)）都正好落在 dot(ℓ,n)=0 上，
// 旧实现（按 dot 符号取 1±0.6m、butt=clamp(φ,±45)）在那里逐样本翻转，两缘锯齿、刃口 ±45° 跳变。
//   s   = dot(ℓ, n) ∈ [−1,1]：ℓ⟂t 时 |s|=1（锋尖全在一侧），ℓ∥t 时 s=0（足迹沿行笔方向拉长，左右对称）
//   wlk = 1 − 0.6·m·s，wrk = 1 + 0.6·m·s      （s>0 锋尖在 wl 侧 → wl 薄；过零连续）
//   tipSide 只在 |s|>0.2 时报侧
//   butt（刃口斜角，度）= BUTT_MAX_DEG · sign(φ) · sin²(2φ) · ramp(m)，φ = n→ℓ 有符号角折叠到 (−90°,90°]
//     φ=0 与 φ=±90° 处为 0 且导数为 0（az 抖 ±1° 变化 <0.15°），φ=±45° 处 ±45° 峰值；
//     ramp(m) = clamp01((m − BUTT_M_GATE) / 0.15) 让刃口随侧锋量渐入而不是在门限处跳出来。
//     m ≤ BUTT_M_GATE → butt=false（brush.js 补圆头帽）；m > 门限但角度≈0 → butt=true（平切、不旋转）。
//     门限只看 m（alt 决定、每笔一次），不看 az——避免任何随 az 抖动翻转的二值决策。
//
// butt 符号/几何推理：brush.js 把头部端面法线 n 绕脊点旋转 butt 度（正 = 顺时针，y 向下坐标系里
// 标准旋转矩阵 (cos,−sin; sin,cos) 就是顺时针）。侧锋切入时毫束贴纸的足迹是以 ℓ 为长轴的椭圆，
// 起笔端面 ≈ 椭圆上两条平行于 t 的切线切点连线（t 的共轭直径）：ℓ∥n 与 ℓ∥t 时都回到 n（角度 0），
// 中间偏向 ℓ——所以用 n→ℓ 的角而不是任务书字面的「ℓ 与行笔方向 t 的夹角」（两者相差 90°，
// 后者在 ℓ⟂t 时是 ±90° 却应为 0）。峰值形状取 sin²(2φ) 而非精确共轭直径公式
// atan2((r²−1)·sin2φ/2, r²cos²φ+sin²φ)：后者峰值随长短轴比 r 变化（r=1.3 仅 15°、看不出刃口），
// 且 r 大时在 φ→90° 处斜率为 r²−1（陡），对 az 抖动不稳；sin² 两端斜率为 0、峰值固定 45°（沿用旧上限）。
// 局限：brush.js 端面只有圆/平两种，ℓ∥t 时物理上是沿行笔方向拉长的椭圆背面（比圆更钝或更尖），
// 这里退化为不旋转的平切端面。
export function poseShape(alt, az, dir, alt0Rad, gain) {
  const m = sideAmount(alt, alt0Rad, gain);
  if (!dir || m <= 0) return { m, s: 0, wlk: 1, wrk: 1, butt: false, tipSide: 0 };
  const lx = -Math.cos(az), ly = -Math.sin(az);   // 毫束倒向 ℓ：笔腹 → 锋尖
  const nx = -dir.y, ny = dir.x;                   // 法线 n（brush.js 约定）
  const s = Math.max(-1, Math.min(1, lx * nx + ly * ny));   // dot(ℓ,n)：>0 锋尖偏 wl 侧
  const k = 0.6 * m * s;
  const wlk = 1 - k, wrk = 1 + k;
  const tipSide = s > 0.2 ? -1 : (s < -0.2 ? 1 : 0);
  let butt = false;
  if (m > BUTT_M_GATE) {
    let phi = Math.atan2(nx * ly - ny * lx, nx * lx + ny * ly);    // n→ℓ 有符号角（弧度）
    if (phi > Math.PI / 2) phi -= Math.PI; else if (phi <= -Math.PI / 2) phi += Math.PI;   // 端面无向：折叠到 (−90°, 90°]
    const s2 = Math.sin(2 * phi);                                   // 符号 = sign(φ)
    const ramp = Math.min(1, (m - BUTT_M_GATE) / 0.15);
    const ang = BUTT_MAX_DEG * s2 * Math.abs(s2) * ramp;
    butt = Math.abs(ang) < 0.5 ? true : ang;                        // 数字 0 在 brush.js 里等于 false（圆头），用 true 表示平切
  }
  return { m, s, wlk, wrk, butt, tipSide };
}

export class PenInput {
  // deps: {
  //   brush(), paper(), inkCtx()   → 当前实例（setup() 会重建，用 getter）
  //   busy()                       → true 时不接受落笔（播放器书写中）；书写中变真则丢弃当前笔
  //   onFrame()                    → 每个指针事件后重绘覆盖层/墨量条
  //   basePressure()               → 鼠标基准压力（滑块）
  //   poseOn(), alt0Deg(), gain()  → 姿态直连开关与参数
  //   hud                          → HUD DOM 元素（可为 null）
  // }
  constructor(canvas, deps) {
    this.canvas = canvas;
    this.deps = deps;
    this.active = null;        // 当前笔：{ id, type, begun, pending, last, anchor, dir, rec, events, samples }
    this.strokes = [];         // 录制的笔（每笔 { id, type, t0, poseSource, events, samples:[...] }）
    this.maxStrokes = 300;
    this.hover = null;         // 最近一次 pen 悬停姿态 { alt, az, src }
    this.stats = { times: [], rate: 0, coalesced: 0, latency: null, p: 0, alt: null, az: null, src: 'none', m: 0, tipSide: 0 };
    this._hudAt = 0;
    this._seq = 0;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this._down(e));
    c.addEventListener('pointermove', e => this._move(e));
    c.addEventListener('pointerup', e => this._up(e));
    c.addEventListener('pointercancel', e => this._cancel(e));
    c.addEventListener('lostpointercapture', e => this._cancel(e));
    c.addEventListener('contextmenu', e => e.preventDefault());
    // 兜底：capture 失败后在画布外松开 → 画布收不到 up，window 能；失焦/切后台也收笔（不喂样本）
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pointerup', e => this._cancel(e));
      window.addEventListener('pointercancel', e => this._cancel(e));
      window.addEventListener('blur', () => this.abort());
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.abort(); });
    }
  }

  _accepts(e) { return e.pointerType === 'pen' || e.pointerType === 'mouse'; }

  _down(e) {
    if (e.pointerType === 'touch') { e.preventDefault(); return; }   // 手掌/手指：不落墨
    if (!this._accepts(e)) return;
    const cur = this.active;
    if (cur) {
      // 同一指针再次落下 = 上次 up/cancel 丢了（Chrome 鼠标 pointerId 恒为 1）；
      // 别的指针落下且当前笔早已无样本 = 当前笔失效。两者都先收掉旧笔，再正常开新笔。
      const idle = performance.now() - (cur.last ? cur.last.t : cur.rec.t0);
      if (e.pointerId === cur.id || idle > STALE_MS) this._finish(null);
      else return;                                                    // 第二个指针：忽略，不打断当前笔
    }
    if (this.deps.busy()) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件上会抛 */ }
    const delayBegin = e.pointerType === 'pen' && this.deps.poseOn();
    this.active = {
      id: e.pointerId, type: e.pointerType, delayBegin,
      begun: false, pending: [], last: null, anchor: null, lastSpeed: 0, dir: null,
      events: 0, samples: 0, moveSamples: 0,
      rec: { id: ++this._seq, type: e.pointerType, t0: e.timeStamp, poseSource: 'none', samples: [] },
    };
    this.stats.times.length = 0;
    const rect = this.canvas.getBoundingClientRect();
    this._feed(e, rect, true);
    this._afterEvent(e);
  }

  _move(e) {
    const a = this.active;
    if (!a) {
      // 悬停（Pencil buttons===0）：只更新 HUD 姿态，不落墨
      if (e.pointerType === 'pen') { this.hover = poseOf(e); this._updateHud(e, true); }
      return;
    }
    if (e.pointerId !== a.id) { if (e.pointerType === 'touch') e.preventDefault(); return; }
    const cs = e.getCoalescedEvents?.();
    const samples = (cs && cs.length) ? cs : [e];
    const rect = this.canvas.getBoundingClientRect();
    a.events++;
    a.moveSamples += samples.length;   // 合并样本数只按 pointermove 统计（down/up 不算）
    for (const s of samples) this._feed(s, rect, false);
    this._afterEvent(e);
  }

  _up(e) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    // 提笔点也作为最后一个样本：pen 压力 0 → p=0.004，行进中提笔自然收成针尖；原地提笔则无变化
    this._feed(e, this.canvas.getBoundingClientRect(), false);
    this._finish(e);
  }

  // pointercancel / lostpointercapture / window 级 up：同一指针才收笔，不喂样本
  _cancel(e) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    this._finish(e);
  }

  // 外部接管 brush 前调用（播放器启动 / relayout 重建 brush / 清纸 / 失焦）：收掉进行中的手写笔并归档
  abort() { if (this.active) this._finish(null); }

  // 单个样本 → 录制 + 驱动毛笔
  _feed(s, rect, isDown) {
    const a = this.active;
    const brush = this.deps.brush();
    if (!a || !brush) return;
    if (this.deps.busy()) { this._discard(); return; }   // 播放器已接管 brush（正常入口先 abort()，这里是兜底）
    const x = s.clientX - rect.left, y = s.clientY - rect.top;
    const t = s.timeStamp;

    // 速度（px/s）：锚点法——锚点到当前样本 ≥SPEED_DT_MS 才重算并移锚点，否则沿用上一次。
    // 合并样本若共用同一 timeStamp（WebKit 行为未证实），下一个跨帧样本仍拿到整段位移/整段时间。
    let speed = a.lastSpeed;
    if (!a.anchor) { a.anchor = { x, y, t }; speed = 0; }
    else {
      const dt = t - a.anchor.t;
      if (dt >= SPEED_DT_MS) {
        speed = Math.hypot(x - a.anchor.x, y - a.anchor.y) / dt * 1000;
        a.anchor = { x, y, t };
      }
    }
    // 方向：相邻样本位移 ≥0.5px 才更新（太小沿用上一个方向）
    let dir = a.dir;
    if (a.last) {
      const dx = x - a.last.x, dy = y - a.last.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= 0.5) dir = { x: dx / dist, y: dy / dist };
    }
    a.dir = dir;
    a.lastSpeed = speed;

    const pose = poseOf(s);
    let p;
    if (a.type === 'pen') {
      // 起笔前的 0 压力 = 传感器未就绪（iPad 首个 pointerdown 常为 0），留给 _begin 决定；
      // 起笔后的 0 压力 = 离纸尾巴 → 0.004（_halfW 归零）
      p = s.pressure > 0 ? s.pressure : (a.begun ? 0.004 : 0);
    } else {
      const speedLift = Math.min(0.75, (speed / 1000) * 0.55);    // 慢按则重，快提则轻
      p = Math.max(0.05, this.deps.basePressure() - speedLift);
    }

    a.last = { x, y, t };
    a.samples++;
    if (a.rec.samples.length < 20000) {
      a.rec.samples.push({ x: +x.toFixed(2), y: +y.toFixed(2), p: +p.toFixed(4),
        alt: +pose.alt.toFixed(4), az: +pose.az.toFixed(4), t: +t.toFixed(2), type: a.type });
    }
    if (pose.src !== 'none') a.rec.poseSource = pose.src;

    // HUD 统计
    const st = this.stats;
    st.times.push(t);
    while (st.times.length && t - st.times[0] > 1000) st.times.shift();
    st.rate = st.times.length;
    st.p = p; st.alt = pose.alt; st.az = pose.az; st.src = pose.src;
    const lat = performance.now() - t;
    st.latency = st.latency == null ? lat : st.latency * 0.9 + lat * 0.1;

    // 驱动毛笔
    const sample = { x, y, p, speed, alt: pose.alt, az: pose.az, t };
    if (!a.begun) {
      a.pending.push(sample);
      if (!a.delayBegin) { this._begin(a); return; }
      const first = a.pending[0];
      if (a.pending.length >= 3 || t - first.t > 30) this._begin(a);   // 拿到首段方向后再落笔
      return;
    }
    this._moveBrush(a, sample);
  }

  // 起笔压力：pen 缓存样本里第一个 p>BEGIN_P_MIN_REAL 的压力；没有则用最大 p；全为 0 则 MIN_BEGIN_P。
  // 该样本之前的触纸瞬态样本一律抬到起笔压力（否则 begin 后立刻 move 到 0 压力会把起笔掐成针尖）。
  _beginPressure(a) {
    const pend = a.pending;
    if (a.type !== 'pen') return pend[0].p;
    let idx = pend.findIndex(q => q.p > BEGIN_P_MIN_REAL);
    let p0;
    if (idx >= 0) p0 = pend[idx].p;
    else {
      idx = pend.length - 1;
      p0 = 0;
      for (const q of pend) if (q.p > p0) p0 = q.p;
      if (p0 <= 0) p0 = MIN_BEGIN_P;
    }
    for (let i = 0; i <= idx; i++) if (pend[i].p < p0) pend[i].p = p0;
    return p0;
  }

  // 落笔：用缓存样本的首尾位移定行笔方向 → 算 butt 刃口 → begin → 逐个 move 掉缓存
  _begin(a) {
    const brush = this.deps.brush();
    const first = a.pending[0], lastP = a.pending[a.pending.length - 1];
    let dir = null;
    if (a.pending.length > 1) {
      const dx = lastP.x - first.x, dy = lastP.y - first.y, d = Math.hypot(dx, dy);
      if (d >= 1) dir = { x: dx / d, y: dy / d };
    }
    if (dir) a.dir = dir;
    const p0 = this._beginPressure(a);
    let butt = false;
    if (a.delayBegin) {
      const sh = poseShape(first.alt, first.az, dir, this.deps.alt0Deg() * RAD, this.deps.gain());
      butt = sh.butt;
      this.stats.m = sh.m; this.stats.tipSide = sh.tipSide;
    } else {
      this.stats.m = 0; this.stats.tipSide = 0;
    }
    brush.begin(first.x, first.y, p0, butt);
    a.begun = true;
    a.buttUsed = butt;
    a.beginP = p0;
    for (let i = 1; i < a.pending.length; i++) this._moveBrush(a, a.pending[i]);
    a.pending.length = 0;
  }

  _moveBrush(a, s) {
    const brush = this.deps.brush();
    let opts = null;
    if (a.delayBegin) {
      const sh = poseShape(s.alt, s.az, a.dir, this.deps.alt0Deg() * RAD, this.deps.gain());
      opts = { wlk: sh.wlk, wrk: sh.wrk };          // 只传 wlk/wrk，不传 asym
      this.stats.m = sh.m; this.stats.tipSide = sh.tipSide;
    }
    brush.move(s.x, s.y, s.p, this.deps.inkCtx(), this.deps.paper(), s.speed, opts);
  }

  // 正常收笔：未 begin 的点击落成一个点，brush.end() 落墨，归档录制
  _finish(e) {
    const a = this.active;
    if (!a) return;
    if (this.deps.busy()) { this._discard(); return; }   // brush 已属播放器：不能 end() 它的笔
    if (!a.begun && a.pending.length) this._begin(a);   // 点一下就抬：把缓存落成一个点
    const brush = this.deps.brush();
    if (a.begun && brush) brush.end();
    this.active = null;
    this._archive(a, false);
    this.deps.onFrame?.();
    this._updateHud(e, false, true);
  }

  // 丢弃当前笔：不碰 brush（它已被播放器 begin()，end() 会截断播放器的笔），只归档录制
  _discard() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this._archive(a, true);
    this._updateHud(null, false, true);
  }

  _archive(a, aborted) {
    a.rec.events = a.events;
    a.rec.sampleCount = a.samples;
    a.rec.coalescedAvg = a.events ? +(a.moveSamples / a.events).toFixed(2) : 0;
    a.rec.butt = a.buttUsed ?? false;
    a.rec.beginP = a.beginP ?? null;
    a.rec.poseLinked = a.delayBegin;
    if (aborted) a.rec.aborted = true;
    this.strokes.push(a.rec);
    if (this.strokes.length > this.maxStrokes) this.strokes.splice(0, this.strokes.length - this.maxStrokes);
    this.stats.coalesced = a.rec.coalescedAvg;
  }

  _afterEvent(e) {
    const a = this.active;
    if (a && a.events) this.stats.coalesced = a.moveSamples / a.events;
    this.deps.onFrame?.();
    this._updateHud(e, false);
  }

  // ---------- HUD ----------
  _updateHud(e, hoverOnly, force) {
    const el = this.deps.hud;
    if (!el) return;
    const now = performance.now();
    if (!force && now - this._hudAt < 50) return;   // ≤20Hz 刷新 DOM
    this._hudAt = now;
    const st = this.stats;
    const f = (v, d = 0) => (v == null || Number.isNaN(v)) ? '—' : v.toFixed(d);
    let alt = st.alt, az = st.az, src = st.src;
    if (hoverOnly && this.hover) { alt = this.hover.alt; az = this.hover.az; src = this.hover.src; }
    const alt0 = this.deps.alt0Deg() * RAD, gain = this.deps.gain();
    const m = alt == null ? 0 : sideAmount(alt, alt0, gain);
    const cls = m > BUTT_M_GATE ? '侧锋' : '中锋';
    const side = st.tipSide === 0 ? '' : (st.tipSide < 0 ? ' 锋尖→左(wl)' : ' 锋尖→右(wr)');
    const state = this.active ? (this.active.type === 'pen' ? '书写·笔' : '书写·鼠标') : (hoverOnly ? '悬停' : '待笔');
    el.textContent =
      `${state}  ${this.deps.poseOn() ? '姿态直连' : '仅压感'}\n` +
      `压力 ${f(st.p, 2)}  高度 ${f(alt == null ? null : alt * DEG, 0)}°  方位 ${f(az == null ? null : az * DEG, 0)}°  [${src}]\n` +
      `样本 ${f(st.rate)}/s  合并 ${f(st.coalesced, 1)}  延迟 ${f(st.latency, 1)} ms\n` +
      `${cls} m=${f(m, 2)}${this.active ? side : ''}`;
  }

  // ---------- 录制导出 ----------
  export() {
    const brush = this.deps.brush();
    return {
      kind: 'bimo-pen-samples', version: 1,
      exportedAt: new Date().toISOString(),
      ua: navigator.userAgent, dpr: window.devicePixelRatio || 1,
      canvasSize: this.canvas.width,
      brushSize: brush?.size ?? null,
      config: { poseOn: this.deps.poseOn(), alt0Deg: this.deps.alt0Deg(), gain: this.deps.gain() },
      units: { xy: 'canvas px', p: '0..1 (传感器原值；起笔实际用的压力见 strokes[].beginP)', alt: 'rad', az: 'rad (0=+x, cw, π/2=+y)', t: 'ms (event.timeStamp)' },
      strokes: this.strokes,
    };
  }

  clearRecording() { this.strokes.length = 0; }

  // POST 到 /save-json?name=pen-samples（端点在本仓库 server.js）；返回 { ok, status, text }。
  // 404 = 预览服务器进程还是旧版 server.js，重启 node server.js 即可。
  async exportToServer(name = 'pen-samples') {
    const body = JSON.stringify(this.export());
    try {
      const r = await fetch(`/save-json?name=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      const text = await r.text();
      return { ok: r.ok, status: r.status, text, bytes: body.length };
    } catch (err) {
      return { ok: false, status: 0, text: String(err), bytes: body.length };
    }
  }
}
