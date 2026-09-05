// 叠合重合度评估 + 固定尺寸沙箱渲染（调优专用，不参与正常书写）
// 关键：渲染物理非尺度不变，故一切测量在固定 600px 沙箱进行，脱离可见画布视口。
// 用法：在工作台页面控制台 await import('./eval-harness.js')（页面相对；站点在 / 或 /bimo/ 下都行）
//       await __H.init() → 载入真迹、沙箱渲染 strokes.js 五笔、按最近笔画切分参照、出报告
//       await __H.evalNodes(key,k,nodes) → 沙箱渲染候选并对比第 k 笔参照
// 坐标：字格 500x500 掩膜，1px = 2 归一化单位(gu)
//
// —— 基线坐标（M0 确定性金掩膜，2026-09-05）——
//   笔宽 CANON_SIZE（沙箱 brush.size，RSIZE=600 时 1:1 等于滑块值）；CANON_SPEED 1.3；
//   DETERMINISTIC=true 时每次 render 前 sb.brush._strokeCount=0（五笔同种子 7.13）、
//   sb.player.fixedDt = FIXED_DT = 1/60（固定时间片，脱离 rAF 时序）；
//   真迹 ref-cell.png md5 2c0020a610371141f903fc9bdba6835f；掩膜阈值见 redMask/canvasMask。
//   金掩膜存 golden/<name>-whole.png、-s1..s5.png（黑=墨）；H.saveGolden(name) 生成、
//   H.goldenCheck(name) 逐像素比对。实时对照分布需显式 __H.DETERMINISTIC=false。
//   注意：__H.CANON_SIZE 非空时沙箱笔宽以它为准而非滑块；改笔宽后要 __H.resetSandboxes()。
//   资源与端点一律用 import.meta.url 解析（ref-cell.png / golden/ / js/strokes.js / save-png），
//   GitHub Pages 子路径下不需要改；无服务器时 saveGolden 回退为逐张下载 PNG（返回值 mode:'download'）。
(() => {
  // 与本文件同目录的资源（模块 URL 为基准，不依赖页面路径）
  const here = (rel) => new URL(rel, import.meta.url).href;
  const strokesMod = () => import(here('./js/strokes.js?t=' + performance.now()));   // 绕过模块缓存拿最新 strokes.js
  const SAVE_PNG_URL = here('./save-png');
  const N = 500;       // 掩膜分辨率
  const RSIZE = 600;   // 固定渲染画布尺寸（brush.size 基准 = 滑块值）
  const H = window.__H = { N, RSIZE, CANON_SPEED: 1.3,
    CANON_SIZE: 29,        // 基线笔宽（0.900 记录实测在 29 下复现，26 仅 0.863）；置 null 则沙箱首次创建时读滑块 #brushSize
    DETERMINISTIC: true,   // 评估默认确定性（固定 dt + 种子归零）；实时对照需显式关
    FIXED_DT: 1 / 60,      // 确定性时间片（秒）
  };

  const loadImg = (url) => new Promise((res, rej) => {
    const img = new Image(); img.onload = () => res(img); img.onerror = () => rej('load fail ' + url);
    img.src = url + '?t=' + performance.now();
  });
  // 墨迹掩膜：真迹笔画边缘有一圈深色积墨描边（暗红棕，r 低），旧的纯红阈值会把它
  // 时进时出地丢掉 → 轮廓锯齿+悬浮碎片（②竖左缘一列假角点的根源）。
  // 判据改为"非纸色的红棕系"：g 低 + r-g 差 + b 低。
  // 2026-07-08 新参照（多帧平均成品段）干净无伴线，边距回归 12（旧 mgR=100 是给旧参照
  // 裁伴线的，在新参照上会拦腰截断⑤刃 x>800 的部分——教训：换参照必须重审所有口径参数）。
  const redMask = (img, mgL = 12, mgR = 12, mgT = 12, mgB = 12) => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const cc = c.getContext('2d'); cc.drawImage(img, 0, 0, N, N);
    const d = cc.getImageData(0, 0, N, N).data;
    const m = new Uint8Array(N * N);
    for (let y = mgT; y < N - mgB; y++) for (let x = mgL; x < N - mgR; x++) {
      const i = (y * N + x) * 4;
      if (d[i] > 90 && d[i + 1] < 140 && d[i + 2] < 160 && d[i] - d[i + 1] > 35) m[y * N + x] = 1;
    }
    // 去小碎片（格线残段/阈值噪点）：保留 ≥30px 的连通域
    const seen = new Uint8Array(N * N);
    for (let s = 0; s < N * N; s++) {
      if (!m[s] || seen[s]) continue;
      const q = [s]; seen[s] = 1; const px = [];
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
      if (px.length < 30) for (const j of px) m[j] = 0;
    }
    return m;
  };
  const canvasMask = (cvs) => {
    const S = cvs.width, m = S * 0.08, span = S * 0.84;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const cc = c.getContext('2d'); cc.drawImage(cvs, m, m, span, span, 0, 0, N, N);
    const dd = cc.getImageData(0, 0, N, N).data;
    const mask = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) if (dd[i * 4 + 3] > 60) mask[i] = 1;
    return mask;
  };

  H.shape = (m) => {
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x]) { n++; sx += x; sy += y; }
    if (!n) return null;
    const cx = sx / n, cy = sy / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x]) {
      const dx = x - cx, dy = y - cy; sxx += dx*dx; syy += dy*dy; sxy += dx*dy;
    }
    sxx /= n; syy /= n; sxy /= n;
    const tr = sxx + syy, det = sxx*syy - sxy*sxy;
    const l1 = tr/2 + Math.sqrt(Math.max(0, tr*tr/4 - det));
    const l2 = tr/2 - Math.sqrt(Math.max(0, tr*tr/4 - det));
    const ang = Math.atan2(l1 - sxx, sxy);
    return { areaGu2: n*4, centroidGu: [Math.round(cx*2), Math.round(cy*2)],
      lenGu: Math.round(3.46*Math.sqrt(l1)*2), widGu: Math.round(3.46*Math.sqrt(l2)*2),
      angDeg: Math.round(ang*180/Math.PI) };
  };
  H.bbox = (m) => { let x0=N,y0=N,x1=0,y1=0,n=0;
    for (let y=0;y<N;y++) for (let x=0;x<N;x++) if (m[y*N+x]) { n++; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    return n ? { x0:x0*2,y0:y0*2,x1:x1*2,y1:y1*2 } : null; };
  H.cmp = (A, B, searchR = 30, step = 2) => {
    const pts = []; let ac = 0, bc = 0;
    for (let i = 0; i < N*N; i++) { if (A[i]) { pts.push(i); ac++; } if (B[i]) bc++; }
    let inter0 = 0; for (const i of pts) if (B[i]) inter0++;
    let best = { dx:0, dy:0, inter: inter0 };
    for (let dy=-searchR; dy<=searchR; dy+=step) for (let dx=-searchR; dx<=searchR; dx+=step) {
      if (!dx && !dy) continue;
      let s = 0; const off = dy*N + dx;
      for (const i of pts) { const j = i+off; if (j>=0 && j<N*N && B[j]) s++; }
      if (s > best.inter) best = { dx, dy, inter: s };
    }
    return { aPx: ac, bPx: bc, sizeRatio: bc ? +(ac/bc).toFixed(2) : 0,
      iou: +(inter0/(ac+bc-inter0)).toFixed(3), aInB: +(inter0/ac).toFixed(3), bInA: +(inter0/bc).toFixed(3),
      bestShiftGu: [best.dx*2, best.dy*2], iouAtBest: +(best.inter/(ac+bc-best.inter)).toFixed(3) };
  };

  // 沙箱笔宽（设计尺度，600 基准）：CANON_SIZE 优先，否则读滑块；记录到 H.sandboxSize
  const designSize = () => {
    const s = H.CANON_SIZE ?? parseFloat(document.getElementById('brushSize').value);
    H.sandboxSize = s;
    return s;
  };
  // 清缓存沙箱（改笔宽/换 brush 参数后必须调用，否则沿用首次创建的 brush.size）
  H.resetSandboxes = () => { H.sandboxes = {}; H._fastSb = null; };

  // 隐藏标签页（浏览器预览面板）里 rAF 停摆、嵌套 setTimeout 被钳到 1s/次——确定性路径
  // 1/60s/帧会慢 60 倍。确定性渲染期间用 MessageChannel 即时调度顶替 rAF（不受定时器节流；
  // player 在 rAF 回调里 clearTimeout 兜底定时器，故其 120ms 回退永不触发）。fixedDt 下帧时序
  // 不参与计算，结果逐像素不变。实时路径（DETERMINISTIC=false）不换调度器。
  H.FAST_SCHED = true;
  const fastRaf = (() => {
    const mc = new MessageChannel(); const pend = new Map(); let k = 0;
    mc.port1.onmessage = (e) => { const cb = pend.get(e.data); if (cb) { pend.delete(e.data); cb(performance.now()); } };
    return { req: (cb) => { pend.set(++k, cb); mc.port2.postMessage(k); return k; }, cancel: (id) => { pend.delete(id); } };
  })();
  const withScheduler = async (fast, fn) => {
    if (!fast) return fn();
    const oR = window.requestAnimationFrame, oC = window.cancelAnimationFrame;
    window.requestAnimationFrame = fastRaf.req; window.cancelAnimationFrame = fastRaf.cancel;
    try { return await fn(); } finally { window.requestAnimationFrame = oR; window.cancelAnimationFrame = oC; }
  };

  // 固定 600px 沙箱：自带 canvas/brush/paper/player，尺寸与可见视口无关
  H.sandboxes = {};
  H.render = async (key, nodes, speed) => {
    const B = window.__bimo;
    let sb = H.sandboxes[key];
    if (!sb) {
      const cvs = document.createElement('canvas'); cvs.width = cvs.height = RSIZE;
      const BrushC = B.brush.constructor, PlayerC = B.player.constructor, PaperC = B.paper.constructor;
      const brush = new BrushC({ size: designSize() * (RSIZE / 600), stiffness: B.brush.stiffness, color: 'red', layerSize: RSIZE });
      const paper = new PaperC(RSIZE); paper.absorb = B.paper.absorb;
      const player = new PlayerC(brush, paper, cvs.getContext('2d'), null);
      sb = H.sandboxes[key] = { cvs, brush, player };
    }
    sb.player.speed = speed ?? H.CANON_SPEED;
    // 确定性开关：固定时间片 + 噪声种子归零（每笔 begin() 后 _strokeCount=1 → seed 7.13）
    if (H.DETERMINISTIC) { sb.brush._strokeCount = 0; sb.player.fixedDt = H.FIXED_DT; }
    else sb.player.fixedDt = undefined;
    sb.cvs.getContext('2d').clearRect(0, 0, RSIZE, RSIZE);
    sb.brush.dip();
    sb.player.playing = true;
    await withScheduler(H.DETERMINISTIC && H.FAST_SCHED, () => sb.player._writeStroke({ nodes }));
    sb.player.playing = false;
    sb.lastMask = canvasMask(sb.cvs);
    return sb.lastMask;
  };

  // —— 金掩膜：把当前 H.ours 五笔 + 整字掩膜存为黑白 PNG（黑=墨），逐像素可复现基线 ——
  const maskToPngDataURL = (m) => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const cc = c.getContext('2d'); const im = cc.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const v = m[i] ? 0 : 255; im.data[i*4] = im.data[i*4+1] = im.data[i*4+2] = v; im.data[i*4+3] = 255; }
    cc.putImageData(im, 0, 0);
    return c.toDataURL('image/png');
  };
  const pngToMask = (img) => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);   // 1:1 不缩放
    const d = cc.getImageData(0, 0, N, N).data;
    const m = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) if (d[i*4] < 128) m[i] = 1;
    return m;
  };
  const unionMasks = (ms) => { const w = new Uint8Array(N*N); for (const m of ms) for (let i=0;i<N*N;i++) if (m[i]) w[i] = 1; return w; };
  const diffCount = (a, b) => { let n = 0; for (let i = 0; i < N*N; i++) if (a[i] !== b[i]) n++; return n; };

  // 保存一张 PNG（dataURL）：本地 server.js 有 POST save-png → 写 exports/export-<ts>.png 并返回路径；
  // 无服务器（GitHub Pages）时经 js/export-fallback.js 回退为浏览器下载（文件名即 fileName）。
  // 控制台调用没有用户手势，跳过 share/剪贴板。返回 { ok, mode:'server'|'download'|…, text?, name }
  H.savePng = async (dataURL, fileName = 'export-' + Date.now() + '.png') => {
    const { exportBlob, dataURLToBlob } = await import(here('./js/export-fallback.js'));
    return exportBlob({ blob: dataURLToBlob(dataURL), name: fileName, endpoint: SAVE_PNG_URL, serverBody: dataURL,
      allowShare: false, allowClipboard: false });
  };

  // 金掩膜落盘：有服务器 → exports/export-<ts>.png（调用方再移到 golden/<name>-*.png）；
  // 无服务器 → 逐张下载，文件名已是 golden 目标名，直接放进 golden/。返回值 mode 标明走的哪条路。
  H.saveGolden = async (name) => {
    if (!H.ours || H.ours.length !== 5) throw new Error('先 __H.init()/recapture() 得到 H.ours 五笔');
    const items = [['whole', unionMasks(H.ours)], ...H.ours.map((m, k) => ['s' + (k+1), m])];
    const files = [];
    let mode = 'server';
    for (const [tag, m] of items) {
      const fileName = name + '-' + tag + '.png';
      const r = await H.savePng(maskToPngDataURL(m), fileName);
      if (!r.ok) throw new Error(`保存 ${fileName} 失败（${r.mode}${r.status ? ' HTTP ' + r.status : ''}）：${r.text || ''}`);
      if (r.mode !== 'server') mode = r.mode;
      files.push({ target: 'golden/' + fileName, saved: r.mode === 'server' ? r.text : r.mode + ':' + r.name, mode: r.mode,
        px: m.reduce((a, b) => a + b, 0) });
    }
    return { name, size: H.sandboxSize, deterministic: H.DETERMINISTIC, mode, files };
  };

  // 加载 golden/<name>-*.png 回掩膜，与当前 H.ours（rerender=true 则先 recapture）逐像素比对
  H.goldenCheck = async (name, rerender = false) => {
    if (rerender || !H.ours || H.ours.length !== 5) await H.recapture();
    const tags = ['whole', 's1', 's2', 's3', 's4', 's5'];
    const gold = {};
    for (const t of tags) gold[t] = pngToMask(await loadImg(here('./golden/' + name + '-' + t + '.png')));
    const perStroke = H.ours.map((m, k) => {
      const d = diffCount(m, gold['s' + (k+1)]);
      return { s: k+1, identical: d === 0, diffPixels: d, oursPx: m.reduce((a, b) => a + b, 0), goldPx: gold['s'+(k+1)].reduce((a, b) => a + b, 0) };
    });
    const dw = diffCount(unionMasks(H.ours), gold.whole);
    return { name, identical: dw === 0 && perStroke.every(p => p.identical), diffPixels: dw, perStroke };
  };

  // 快渲染整字 IoU（renderFast 五笔并集 vs 真迹），供与实时/确定性路径对照
  H.fastWholeIoU = async () => {
    const mod = await strokesMod();
    const ms = mod.YONG_STROKES.map(s => H.renderFast(s.nodes));
    const per = ms.map((m, k) => H.refStrokes ? H.cmp(m, H.refStrokes[k], 0, 2).iou : null);
    return { wholeIoU: H.cmp(unionMasks(ms), H.truthWhole, 0, 2).iou, perStroke: per };
  };

  // 同步快渲染（跳过实时帧循环，快 ~150x）——沿 Catmull-Rom 直接驱动笔刷。
  // 与实时渲染 IoU 0.83~0.97 一致（略胖 ~10%）。必须先 gridToCanvas 转坐标。
  H._fastSb = null;
  H.renderFast = (gnodes) => {
    const B = window.__bimo, P = B.player;
    if (!H._fastSb) {
      const cvs = document.createElement('canvas'); cvs.width = cvs.height = RSIZE;
      const BrushC = B.brush.constructor, PaperC = B.paper.constructor;
      const brush = new BrushC({ size: designSize()*(RSIZE/600), stiffness: B.brush.stiffness, color:'red', layerSize: RSIZE });
      const paper = new PaperC(RSIZE); paper.absorb = B.paper.absorb;
      H._fastSb = { cvs, ctx: cvs.getContext('2d'), brush, paper };
    }
    const { cvs, ctx, brush, paper } = H._fastSb;
    if (H.DETERMINISTIC) brush._strokeCount = 0;   // 与实时沙箱同种子策略
    const base = P.baseSpeed ?? 300;
    const nodes = gnodes.map(n => { const c = paper.gridToCanvas(n.x, n.y); return { ...n, x: c.x, y: c.y }; });
    ctx.clearRect(0, 0, RSIZE, RSIZE); brush.dip();
    brush.begin(nodes[0].x, nodes[0].y, nodes[0].p, nodes[0].butt ?? false);
    for (let seg = 0; seg < nodes.length - 1; seg++) {
      const a = nodes[seg], b = nodes[seg + 1];
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y) / 2.5));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, pt = P._point(nodes, seg, t);
        const et = P._ease(t);
        const p = a.p + (b.p - a.p) * et;
        const speed = Math.max(20, base * (a.v + (b.v - a.v) * t)) * H.CANON_SPEED;
        const sh = {
          wlk: (a.wlk ?? 1) + ((b.wlk ?? 1) - (a.wlk ?? 1)) * et,
          wrk: (a.wrk ?? 1) + ((b.wrk ?? 1) - (a.wrk ?? 1)) * et,
          asym: (a.asym ?? 0) + ((b.asym ?? 0) - (a.asym ?? 0)) * et,
        };
        brush.move(pt.x, pt.y, p, ctx, paper, speed, sh);
      }
      if (b.dwell) for (let d = 0; d < 3; d++) brush.move(b.x, b.y, b.p, ctx, paper, 0,
        { wlk: b.wlk ?? 1, wrk: b.wrk ?? 1, asym: b.asym ?? 0 });
    }
    brush.end();
    return canvasMask(cvs);
  };

  H.init = async () => {
    const truthImg = await loadImg(here('./ref-cell.png'));
    H.truthWhole = redMask(truthImg);
    const mod = await strokesMod();
    H.strokeDefs = mod.YONG_STROKES;
    H.ours = [];
    for (let i = 0; i < 5; i++) H.ours.push(await H.render('ours' + i, mod.YONG_STROKES[i].nodes));
    // 距离场切分：每个真迹像素归最近的我方笔画
    const BIG = 1e9;
    const distField = (m) => {
      const D = new Float64Array(N*N);
      for (let i=0;i<N*N;i++) D[i] = m[i] ? 0 : BIG;
      for (let y=0;y<N;y++) for (let x=0;x<N;x++) { const i=y*N+x; let v=D[i];
        if(x>0)v=Math.min(v,D[i-1]+3); if(y>0)v=Math.min(v,D[i-N]+3);
        if(x>0&&y>0)v=Math.min(v,D[i-N-1]+4); if(x<N-1&&y>0)v=Math.min(v,D[i-N+1]+4); D[i]=v; }
      for (let y=N-1;y>=0;y--) for (let x=N-1;x>=0;x--) { const i=y*N+x; let v=D[i];
        if(x<N-1)v=Math.min(v,D[i+1]+3); if(y<N-1)v=Math.min(v,D[i+N]+3);
        if(x<N-1&&y<N-1)v=Math.min(v,D[i+N+1]+4); if(x>0&&y<N-1)v=Math.min(v,D[i+N-1]+4); D[i]=v; }
      return D;
    };
    const fields = H.ours.map(distField);
    // 按笔画范畴拆分（容差双归属）：像素归第 k 笔，除非其他笔明显更近（差超 M）。
    // 交叠区（如⑤捺起笔搭在②竖身上）同时归两笔——各笔拿到自己的完整形态；
    // 绝不把别笔的起笔头按"最近距离"划给本笔（旧最近切分的病根）。
    const M = 6 * 3; // 距离场每步 3/4 计价，6px 容差
    H.refStrokes = [0,1,2,3,4].map(() => new Uint8Array(N*N));
    for (let i=0;i<N*N;i++) {
      if (!H.truthWhole[i]) continue;
      let bd = Infinity;
      for (let k=0;k<5;k++) if (fields[k][i]<bd) bd = fields[k][i];
      for (let k=0;k<5;k++) if (fields[k][i] <= bd + M) H.refStrokes[k][i] = 1;
    }
    return H.report();
  };

  // —— 无偏逐笔评分：固定其余四笔、只看整字与真迹重合 ——
  // 先 setContext(k) 缓存"其余四笔"并集（用最新 strokes.js），再反复 evalWhole(k,key,nodes)
  H._others = {};
  H.setContext = async (k) => {
    const mod = await strokesMod();
    H.strokeDefs = mod.YONG_STROKES;
    let others = new Uint8Array(N * N);
    for (let j = 0; j < 5; j++) {
      if (j === k) continue;
      const mj = await H.render('ctx' + j, mod.YONG_STROKES[j].nodes);
      for (let i = 0; i < N * N; i++) if (mj[i]) others[i] = 1;
    }
    H._others[k] = others;
    // 基线：用真节点渲染第 k 笔的整字 IoU
    const mk = await H.render('base' + k, mod.YONG_STROKES[k].nodes);
    const whole = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) whole[i] = others[i] || mk[i] ? 1 : 0;
    return { k, baseWholeIoU: H.cmp(whole, H.truthWhole, 0, 2).iou };
  };
  H.evalWhole = async (k, key, nodes, speed) => {
    const others = H._others[k];
    if (!others) return { error: '先调用 __H.setContext(' + k + ')' };
    const mk = await H.render(key, nodes, speed);
    const whole = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) whole[i] = others[i] || mk[i] ? 1 : 0;
    const wIoU = H.cmp(whole, H.truthWhole, 0, 2).iou;   // 无偏整字目标
    const kCmp = H.cmp(mk, H.refStrokes[k], 20, 2);       // 该笔诊断（自参照，仅参考）
    return { wholeIoU: +wIoU.toFixed(4), strokeShape: H.shape(mk),
      strokeVsPartition: { iou: kCmp.iou, bestShiftGu: kCmp.bestShiftGu } };
  };

  // 用最新 strokes.js 重采我方五笔（改完节点后调用）
  H.recapture = async () => {
    const mod = await strokesMod();
    H.strokeDefs = mod.YONG_STROKES;
    H.ours = [];
    for (let i = 0; i < 5; i++) H.ours.push(await H.render('ours' + i, mod.YONG_STROKES[i].nodes));
    return H.report();
  };

  H.evalNodes = async (key, k, nodes, speed) => {
    const mask = await H.render(key, nodes, speed);
    const cmp = H.cmp(mask, H.refStrokes[k], 30, 2);
    return { ...cmp, ours: H.shape(mask), ref: H.shape(H.refStrokes[k]), refBbox: H.bbox(H.refStrokes[k]) };
  };

  H.report = () => {
    const per = H.ours.map((m, k) => {
      const cmp = H.cmp(m, H.refStrokes[k], 30, 2);
      const os = H.shape(m), rs = H.shape(H.refStrokes[k]);
      return { stroke: k+1, iou: cmp.iou, iouAtBest: cmp.iouAtBest, shift: cmp.bestShiftGu,
        ourCover: cmp.aInB, refCover: cmp.bInA,
        gap: { dCx: rs.centroidGu[0]-os.centroidGu[0], dCy: rs.centroidGu[1]-os.centroidGu[1],
          lenR: +(rs.lenGu/os.lenGu).toFixed(2), widR: +(rs.widGu/os.widGu).toFixed(2),
          dAng: rs.angDeg-os.angDeg, areaR: +(rs.areaGu2/os.areaGu2).toFixed(2) },
        ours: os, ref: rs };
    });
    const whole = new Uint8Array(N*N);
    for (const m of H.ours) for (let i=0;i<N*N;i++) if (m[i]) whole[i] = 1;
    const wcmp = H.cmp(whole, H.truthWhole, 20, 2);
    H.wholeMask = whole;
    return { rsize: RSIZE, wholeIoU: wcmp.iou, wholeCover: wcmp.aInB, wholeRefCover: wcmp.bInA,
      perStroke: per.map(p => ({ s: p.stroke, iou: p.iou, ourCover: p.ourCover, refCover: p.refCover, gap: p.gap })),
      shapes: per.map(p => ({ s: p.stroke, ours: p.ours, ref: p.ref })) };
  };

  H.overlay = (ourMask, refMask) => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const cc = c.getContext('2d'); const im = cc.createImageData(N, N);
    for (let i=0;i<N*N;i++) {
      const a = ourMask[i], b = refMask[i]; let r,g,bl;
      if (!a && !b) { r=245; g=241; bl=230; }
      else if (a && b) { r=90; g=20; bl=120; }
      else if (a) { r=200; g=40; bl=30; }
      else { r=40; g=90; bl=200; }
      im.data[i*4]=r; im.data[i*4+1]=g; im.data[i*4+2]=bl; im.data[i*4+3]=255;
    }
    cc.putImageData(im, 0, 0);
    return c.toDataURL('image/png');
  };

  return 'harness file loaded';
})();
