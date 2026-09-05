// 宣纸模型：底色 + 纤维噪声（影响墨的沉积）+ 米字格
export class Paper {
  constructor(size) {
    this.size = size;
    this.absorb = 0.35;

    // 纤维噪声场（半分辨率采样即可）
    this.gRes = Math.ceil(size / 2);
    this.grain = new Float32Array(this.gRes * this.gRes);
    let seed = 42;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    // 两层值噪声：粗纹理 + 细纤维
    const coarse = this._noiseLayer(rnd, this.gRes, 14);
    const fine = this._noiseLayer(rnd, this.gRes, 4);
    for (let i = 0; i < this.grain.length; i++) {
      this.grain[i] = 0.72 + coarse[i] * 0.33 + fine[i] * 0.28;
    }
  }

  _noiseLayer(rnd, res, cell) {
    const gw = Math.ceil(res / cell) + 2;
    const g = new Float32Array(gw * gw);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const out = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
      const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < res; x++) {
        const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const i00 = g[y0 * gw + x0], i10 = g[y0 * gw + x0 + 1];
        const i01 = g[(y0 + 1) * gw + x0], i11 = g[(y0 + 1) * gw + x0 + 1];
        out[y * res + x] =
          (i00 * (1 - sx) + i10 * sx) * (1 - sy) +
          (i01 * (1 - sx) + i11 * sx) * sy;
      }
    }
    return out;
  }

  grainAt(x, y) {
    const gx = Math.max(0, Math.min(this.gRes - 1, (x / 2) | 0));
    const gy = Math.max(0, Math.min(this.gRes - 1, (y / 2) | 0));
    return this.grain[gy * this.gRes + gx];
  }

  // 画纸面底色 + 米字格
  drawBackground(ctx, showGrid) {
    const s = this.size;
    ctx.clearRect(0, 0, s, s);

    // 宣纸底色（带轻微纹理）
    ctx.fillStyle = '#f5f1e6';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 400; i++) {
      const x = (i * 971) % s, y = (i * 557) % s;
      ctx.fillStyle = i % 2 ? '#d8d2c0' : '#ffffff';
      ctx.fillRect(x, y, 30 + (i % 40), 2 + (i % 5));
    }
    ctx.globalAlpha = 1;

    if (!showGrid) return;

    // 米字格：红框 + 十字/对角虚线
    const m = s * 0.08;           // 边距
    const g = s - m * 2;
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = Math.max(2, s * 0.006);
    ctx.strokeRect(m, m, g, g);

    ctx.strokeStyle = 'rgba(192, 57, 43, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(m + g / 2, m); ctx.lineTo(m + g / 2, m + g);   // 竖中线
    ctx.moveTo(m, m + g / 2); ctx.lineTo(m + g, m + g / 2);   // 横中线
    ctx.moveTo(m, m); ctx.lineTo(m + g, m + g);               // 对角
    ctx.moveTo(m + g, m); ctx.lineTo(m, m + g);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 字格内坐标（0..1000）→ 画布像素
  gridToCanvas(gx, gy) {
    const m = this.size * 0.08;
    const g = this.size - m * 2;
    return { x: m + (gx / 1000) * g, y: m + (gy / 1000) * g };
  }
}
