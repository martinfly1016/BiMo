// 轮廓曲率分析工具（挂到 __H 上，不覆盖 harness 状态）
// 方法论（①点验证有效）：Moore 边界追踪 → 等距重采样 → 窗口转角 → 角点计数/着色。
// 真迹角点结构是笔法特征的数学形态：如①点=3角点（入锋尖/腹尾交界/尾尖）+其余曲率连续。
// 注意：refStrokes[k] 是最近笔画切分，交叠区（②与④⑤、⑤与②③）有假轮廓/假角点，看图人工甄别。
(() => {
  const H = window.__H;
  const N = H.N;

  // 最大连通域（BFS），去掉切分产生的远处碎片
  H.cc = (m) => {
    const seen = new Uint8Array(N * N);
    let best = null;
    for (let i = 0; i < N * N; i++) {
      if (!m[i] || seen[i]) continue;
      const q = [i]; seen[i] = 1; const px = [];
      while (q.length) {
        const j = q.pop(); px.push(j);
        const x = j % N, y = (j / N) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
          const jj = ny * N + nx;
          if (m[jj] && !seen[jj]) { seen[jj] = 1; q.push(jj); }
        }
      }
      if (!best || px.length > best.length) best = px;
    }
    const out = new Uint8Array(N * N);
    if (best) for (const j of best) out[j] = 1;
    return out;
  };

  // Moore 边界追踪（8 邻域外轮廓，顺时针）
  H.trace = (mask) => {
    const m = H.cc(mask);
    let sx = -1, sy = -1;
    for (let i = 0; i < N * N; i++) if (m[i]) { sx = i % N; sy = (i / N) | 0; break; }
    if (sx < 0) return [];
    const dx8 = [0, 1, 1, 1, 0, -1, -1, -1], dy8 = [-1, -1, 0, 1, 1, 1, 0, -1]; // N NE E SE S SW W NW
    const fg = (x, y) => x >= 0 && x < N && y >= 0 && y < N && !!m[y * N + x];
    const pts = [[sx, sy]];
    let px = sx, py = sy, search = 6; // 起点左邻必为背景，从 W 开始顺时针扫
    for (let step = 0; step < 200000; step++) {
      let found = -1;
      for (let i = 0; i < 8; i++) {
        const d = (search + i) % 8;
        if (fg(px + dx8[d], py + dy8[d])) { found = d; break; }
      }
      if (found < 0) break;                       // 孤立单像素
      px += dx8[found]; py += dy8[found];
      if (px === sx && py === sy) break;          // 闭合
      pts.push([px, py]);
      search = (found + 6) % 8;                   // 进入方向逆时针转 90° 作为新扫描起点
    }
    return pts;
  };

  // 闭合折线等距重采样
  H.resamp = (pts, step = 1.5) => {
    if (pts.length < 3) return pts.slice();
    const out = [pts[0].slice()];
    let carry = 0;
    for (let i = 1; i <= pts.length; i++) {
      let a = out.length ? [pts[i - 1][0], pts[i - 1][1]] : null;
      const b = pts[i % pts.length];
      let ax = pts[i - 1][0], ay = pts[i - 1][1];
      let d = Math.hypot(b[0] - ax, b[1] - ay);
      let t0 = 0;
      while (carry + (d - t0) >= step) {
        const need = step - carry;
        const t = t0 + need;
        const u = t / d;
        out.push([ax + (b[0] - ax) * u, ay + (b[1] - ay) * u]);
        t0 = t; carry = 0;
      }
      carry += d - t0;
    }
    return out;
  };

  // 每点窗口转角（度）：前向切线 vs 后向切线的夹角，正=左转（凸），负=右转（凹，因顺时针追踪）
  H.turns = (pts, k = 5) => {
    const n = pts.length;
    const out = new Float64Array(n);
    if (n < 2 * k + 1) return out;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - k + n) % n], p1 = pts[i], p2 = pts[(i + k) % n];
      const thb = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const thf = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      out[i] = wrap(thf - thb) * 180 / Math.PI;
    }
    return out;
  };

  // 角点：|转角| 超阈值的非极大值抑制局部峰
  H.corners = (pts, turns, thresh = 45, nmsR = 6) => {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const t = Math.abs(turns[i]);
      if (t < thresh) continue;
      let isMax = true;
      for (let d = -nmsR; d <= nmsR; d++) {
        if (!d) continue;
        if (Math.abs(turns[(i + d + n) % n]) > t) { isMax = false; break; }
      }
      if (isMax) out.push({ i, x: pts[i][0], y: pts[i][1], turn: Math.round(turns[i]) });
    }
    return out;
  };

  // 双掩膜轮廓对比图：并排放大、按 |转角| 着色、角点圈注。返回 dataURL
  // opts: { step, k, thresh, pad }
  H.contourPanel = (maskA, maskB, labelA = '真迹', labelB = '我方', opts = {}) => {
    const { step = 1.5, k = 5, thresh = 45, pad = 12 } = opts;
    const prep = (mask) => {
      const raw = H.trace(mask);
      const pts = H.resamp(raw, step);
      const tn = H.turns(pts, k);
      const cs = H.corners(pts, tn, thresh);
      return { pts, tn, cs };
    };
    const A = prep(maskA), B = prep(maskB);
    // 联合 bbox（掩膜坐标 0..N）
    let x0 = N, y0 = N, x1 = 0, y1 = 0;
    for (const P of [A.pts, B.pts]) for (const [x, y] of P) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const PW = 520, TH = 30;
    const sc = Math.min(PW / (x1 - x0), PW / (y1 - y0));
    const cvs = document.createElement('canvas');
    cvs.width = PW * 2 + 30; cvs.height = PW + TH + 20;
    const c = cvs.getContext('2d');
    c.fillStyle = '#faf7ee'; c.fillRect(0, 0, cvs.width, cvs.height);
    c.font = '16px sans-serif'; c.textAlign = 'center';
    const tint = (t) => {
      const a = Math.abs(t);
      if (a < 8) return '#8899bb';        // 直/缓弧
      if (a < 25) return '#3aa03a';       // 中曲率
      if (a < thresh) return '#e08a00';   // 高曲率
      return '#d02020';                    // 角点级
    };
    const drawPanel = (D, ox, label, nCorner) => {
      c.fillStyle = '#333';
      c.fillText(`${label} · 角点 ${nCorner}`, ox + PW / 2, 20);
      c.save(); c.translate(ox, TH);
      // 剪影
      c.beginPath();
      for (let i = 0; i < D.pts.length; i++) {
        const [x, y] = D.pts[i];
        const px = (x - x0) * sc, py = (y - y0) * sc;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath(); c.fillStyle = 'rgba(120,110,100,0.12)'; c.fill();
      // 曲率着色轮廓点
      for (let i = 0; i < D.pts.length; i++) {
        const [x, y] = D.pts[i];
        c.fillStyle = tint(D.tn[i]);
        c.fillRect((x - x0) * sc - 1.2, (y - y0) * sc - 1.2, 2.4, 2.4);
      }
      // 角点标注
      c.strokeStyle = '#d02020'; c.lineWidth = 1.5; c.font = '13px sans-serif';
      for (const q of D.cs) {
        const px = (q.x - x0) * sc, py = (q.y - y0) * sc;
        c.beginPath(); c.arc(px, py, 9, 0, Math.PI * 2); c.stroke();
        c.fillStyle = '#a01010';
        c.fillText(`${q.turn}°`, px + 14, py - 8);
      }
      c.restore();
    };
    drawPanel(A, 10, labelA, A.cs.length);
    drawPanel(B, PW + 20, labelB, B.cs.length);
    return { url: cvs.toDataURL('image/png'),
      report: { [labelA]: A.cs.map(q => ({ guX: q.x * 2, guY: q.y * 2, turn: q.turn })),
                [labelB]: B.cs.map(q => ({ guX: q.x * 2, guY: q.y * 2, turn: q.turn })) } };
  };

  // 一步到位：第 k 笔（0 基）真迹切分 vs 我方，出图存盘 + 返回角点报告
  H.strokeContour = async (k, opts = {}) => {
    const { url, report } = H.contourPanel(H.refStrokes[k], H.ours[k], `真迹 第${k + 1}笔`, `我方 第${k + 1}笔`, opts);
    const resp = await fetch('/save-png', { method: 'POST', body: url });
    return { file: await resp.text(), corners: report };
  };

  // 窗口裁剪（gu 坐标矩形）：切分掩膜在交叠区有假轮廓，改从整字掩膜裁"该笔独占区域"
  H.cropMask = (mask, gx0, gy0, gx1, gy1) => {
    const out = new Uint8Array(N * N);
    const x0 = gx0 / 2, y0 = gy0 / 2, x1 = gx1 / 2, y1 = gy1 / 2;
    for (let y = Math.max(0, y0 | 0); y < Math.min(N, y1); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(N, x1); x++)
        out[y * N + x] = mask[y * N + x];
    return out;
  };

  // 窗口轮廓对比：真迹整字掩膜 vs 我方第 k 笔，同一 gu 窗口内对比（窗口边界的假角点自行忽略）
  H.windowContour = async (k, rect, tag, opts = {}) => {
    const [gx0, gy0, gx1, gy1] = rect;
    const tm = H.cropMask(H.truthWhole, gx0, gy0, gx1, gy1);
    const om = H.cropMask(H.ours[k], gx0, gy0, gx1, gy1);
    const { url, report } = H.contourPanel(tm, om, `真迹·${tag}`, `我方·${tag}`, opts);
    const resp = await fetch('/save-png', { method: 'POST', body: url });
    return { file: await resp.text(), corners: report };
  };

  // 竖向宽度剖面：每行追踪主 run（与上一行中心最近），输出左右缘与宽度随 y 的变化
  H.widthProfile = (mask, gx0, gy0, gx1, gy1, sampleEvery = 4) => {
    const rows = [];
    let prevC = null;
    for (let y = gy0 / 2 | 0; y < gy1 / 2; y++) {
      const runs = [];
      let s = -1;
      for (let x = gx0 / 2 | 0; x <= gx1 / 2; x++) {
        const on = x < gx1 / 2 && mask[y * N + x];
        if (on && s < 0) s = x;
        if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
      }
      if (!runs.length) { prevC = null; continue; }
      let best = runs[0];
      if (prevC != null) {
        let bd = Infinity;
        for (const r of runs) { const c = (r[0] + r[1]) / 2, d = Math.abs(c - prevC); if (d < bd) { bd = d; best = r; } }
      } else {
        for (const r of runs) if (r[1] - r[0] > best[1] - best[0]) best = r;
      }
      prevC = (best[0] + best[1]) / 2;
      if (((y * 2) | 0) % sampleEvery === 0)
        rows.push({ gy: y * 2, l: best[0] * 2, r: best[1] * 2, w: (best[1] - best[0] + 1) * 2 });
    }
    return rows;
  };

  return 'contour tools loaded';
})();
