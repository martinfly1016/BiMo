// 自动书写播放器：沿笔法脚本驱动毛笔，模拟人的运笔节奏
import { YONG_STROKES } from './strokes.js';

export class Player {
  constructor(brush, paper, inkCtx, overlay) {
    this.brush = brush;
    this.paper = paper;
    this.inkCtx = inkCtx;
    this.overlay = overlay; // { ctx, draw callbacks } 由 main 提供重绘
    this.playing = false;
    this.speed = 1;
    this.onStrokeChange = null; // (index, stroke) => void
    this.onDone = null;
    this.baseSpeed = 300;       // px/s 基准行笔速度
  }

  // 把字格坐标节点转换为画布坐标
  _canvasNodes(stroke) {
    return stroke.nodes.map(n => {
      const c = this.paper.gridToCanvas(n.x, n.y);
      return { ...n, x: c.x, y: c.y };
    });
  }

  playAll() { return this._run(YONG_STROKES.map((_, i) => i)); }
  playOne(i) { return this._run([i]); }

  stop() { this.playing = false; }

  async _run(indices) {
    if (this.playing) return;
    this.playing = true;
    this.brush.dip(); // 书写前蘸墨一次，整字一笔墨写完（末尾自然渐枯）

    for (const i of indices) {
      if (!this.playing) break;
      const stroke = YONG_STROKES[i];
      this.onStrokeChange?.(i, stroke);
      await this._writeStroke(stroke);
      if (this.playing) await this._sleep(320 / this.speed); // 笔画间换气
    }
    this.playing = false;
    this.onDone?.();
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 沿 Catmull-Rom 样条书写一个笔画
  async _writeStroke(stroke) {
    const nodes = this._canvasNodes(stroke);
    const brush = this.brush;

    return new Promise(resolve => {
      let seg = 0;        // 当前节点段 nodes[seg] -> nodes[seg+1]
      let t = 0;          // 段内参数 0..1
      let dwellLeft = 0;  // 顿笔剩余时间
      let last = performance.now();
      let begun = false;

      // rAF + 定时器双调度：标签页被节流/隐藏时书写仍按真实时间推进。
      // 页面不可见时放宽单帧时间片——盖章按 ~1.2px 细分，大步推进不影响墨迹。
      let rafId = 0, toId = 0;
      const schedule = () => {
        rafId = requestAnimationFrame(ts => { clearTimeout(toId); frame(ts); });
        toId = setTimeout(() => {
          cancelAnimationFrame(rafId);
          frame(performance.now());
        }, 120);
      };

      const frame = (now) => {
        if (!this.playing) { brush.end(); resolve(); return; }
        const cap = document.hidden ? 3 : 0.12;
        const dt = Math.min(cap, (now - last) / 1000);
        last = now;

        // 起笔必须锚定在节点 0（否则高速下第一帧就越过起笔段，针尖被吃掉）
        if (!begun) { brush.begin(nodes[0].x, nodes[0].y, nodes[0].p, nodes[0].butt ?? false); begun = true; }

        // 按真实流逝时间推进（可跨多段），页面掉帧也不拖慢书写节奏
        let remaining = dt * this.speed;
        let guard = 2000;
        while (remaining > 1e-4 && seg < nodes.length - 1 && guard-- > 0) {
          const a = nodes[seg], b = nodes[seg + 1];

          if (dwellLeft > 0) {
            // 顿笔：原地驻笔，压力继续向目标过渡（墨在此累积、洇开）
            const use = Math.min(dwellLeft, remaining);
            dwellLeft -= use;
            remaining -= use;
            const pos = this._point(nodes, seg, t);
            if (!begun) { brush.begin(pos.x, pos.y, a.p, nodes[0].butt ?? false); begun = true; }
            brush.move(pos.x, pos.y, b.p, this.inkCtx, this.paper, 0,
              { wlk: a.wlk ?? 1, wrk: a.wrk ?? 1, asym: a.asym ?? 0 }); // 驻笔
            continue;
          }

          const segLen = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
          const v = Math.max(20, this.baseSpeed * (a.v + (b.v - a.v) * t));
          const timeLeftInSeg = ((1 - t) * segLen) / v;
          // 单次推进 ≤4px：高速/掉帧时也沿样条密集采样，保住针尖与小曲率细节
          const stepTime = Math.min(remaining, timeLeftInSeg, 4 / v);

          if (stepTime < timeLeftInSeg) {
            t += (v * stepTime) / segLen;
            remaining -= stepTime;
          } else {
            remaining -= timeLeftInSeg;
            t = 0;
            seg++;
            if (b.dwell) dwellLeft = b.dwell;
          }

          const cur = seg < nodes.length - 1 ? this._point(nodes, seg, t)
                                             : nodes[nodes.length - 1];
          const last = seg >= nodes.length - 1;
          const sa = nodes[Math.min(seg, nodes.length - 1)];
          const sb = nodes[Math.min(seg + 1, nodes.length - 1)];
          const et = last ? 1 : this._ease(t);
          const p = last ? 0 : sa.p + (sb.p - sa.p) * et;
          // 形状控制沿段插值：左右半宽比例 wlk/wrk、侧偏 asym（缎带模型的细节参数）
          const sh = {
            wlk: (sa.wlk ?? 1) + ((sb.wlk ?? 1) - (sa.wlk ?? 1)) * et,
            wrk: (sa.wrk ?? 1) + ((sb.wrk ?? 1) - (sa.wrk ?? 1)) * et,
            asym: (sa.asym ?? 0) + ((sb.asym ?? 0) - (sa.asym ?? 0)) * et,
          };

          if (!begun) { brush.begin(cur.x, cur.y, nodes[0].p, nodes[0].butt ?? false); begun = true; }
          brush.move(cur.x, cur.y, p, this.inkCtx, this.paper, v * this.speed, sh);
        }

        this.overlay?.();

        if (seg >= nodes.length - 1) {
          brush.end();
          this.overlay?.();
          resolve();
        } else {
          schedule();
        }
      };
      schedule();
    });
  }

  _ease(t) { return t * t * (3 - 2 * t); } // 压力过渡平滑（提按不生硬）

  // Catmull-Rom 插值：让折点之外的行笔带弧度（直中见曲）
  // 节点带 corner:true 时按端点处理（钳断切线）——路径在该点硬拐不被样条圆化，
  // 用于顿笔转向的方角（折肩、顿脚）。
  _point(nodes, seg, t) {
    let p0 = nodes[Math.max(0, seg - 1)];
    const p1 = nodes[seg];
    const p2 = nodes[Math.min(nodes.length - 1, seg + 1)];
    let p3 = nodes[Math.min(nodes.length - 1, seg + 2)];
    if (p1.corner) p0 = p1;
    if (p2.corner) p3 = p2;
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) =>
      0.5 * ((2 * b) + (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3);
    return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
  }
}
