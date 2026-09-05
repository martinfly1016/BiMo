# golden/ — 永字确定性金掩膜基线

黑白 PNG，500×500，黑 = 墨（沙箱 600px 画布中央 84% 区域按 canvasMask 阈值 alpha>60 采样）。
`<name>-whole.png` 为五笔并集，`<name>-s1..s5.png` 为逐笔。由 `__H.saveGolden(name)` 生成、`__H.goldenCheck(name)` 逐像素校验。

## 2026-09-05 — M0 确定性基线建立

### 基线坐标（两组金掩膜共用，仅笔宽不同）
| 项 | 值 |
|---|---|
| 笔宽 `H.CANON_SIZE`（沙箱 brush.size，RSIZE=600 → 与滑块值 1:1） | **29**（默认）；对照组 26 |
| `H.CANON_SPEED` | 1.3 |
| `player.fixedDt`（`H.FIXED_DT`） | 1/60 s（`H.DETERMINISTIC=true` 时每次 render 前设置） |
| 噪声种子策略 | 每次 render 前 `sb.brush._strokeCount = 0` → begin() 后 =1 → `_noiseSeed = 7.13`（五笔同种子） |
| 调度器 | `H.FAST_SCHED=true`：确定性渲染期间用 MessageChannel 顶替 rAF（隐藏标签页里 rAF 停摆、嵌套定时器被钳到 1s）；fixedDt 下时序不进入计算 |
| 真迹 `ref-cell.png` md5 | `2c0020a610371141f903fc9bdba6835f` |
| 真迹掩膜 redMask | r>90 && g<140 && b<160 && r-g>35，边距 12，去 <30px 碎片 |
| strokes.js | 与 git `28a0e68` 一致（未改） |
| 复现性 | 同一配置两次确定性 recapture 逐像素 0 差异（29 与 26 各验证一次），PNG 往返 goldenCheck identical |

### yong-s29-dt60（笔宽 29，基线）
- 确定性整字 IoU **0.898**；逐笔 ①0.813 ②0.902 ③0.894 ④0.847 ⑤0.884
- 掩膜像素数：whole 29717；s1 3113、s2 11624、s3 6202、s4 2062、s5 7382
- 实时路径（DETERMINISTIC=false，页面处于隐藏标签页）5 次整字 IoU：**0.900, 0.898, 0.898, 0.899, 0.899**
  - 第 1 次逐笔 ①0.821 ②0.904 ③0.892 ④0.859 ⑤0.885（与历史记录 ①0.821 ②0.902 ③0.895 ④0.858 ⑤0.894 吻合）
- renderFast 整字 IoU 0.895；逐笔 ①0.808 ②0.901 ③0.890 ④0.848 ⑤0.883

### yong-s26-dt60（笔宽 26，对照）
- 确定性整字 IoU **0.863**；逐笔 ①0.804 ②0.867 ③0.852 ④0.858 ⑤0.835
- 掩膜像素数：whole（见 PNG）；s1 2748、s2 10501、s3 5587、s4 1851、s5 6645
- 实时路径 5 次整字 IoU：0.864, 0.865, 0.864, 0.864, 0.868
- renderFast 整字 IoU 0.862；逐笔 ①0.798 ②0.866 ③0.852 ④0.860 ⑤0.834

### 结论
历史记录 0.900（噪声带 ±0.005）是在**笔宽 29** 下测得（index.html 默认 29；eval-harness.js 旧注释"滑块值(26)"已过期）。
26 下整字仅 0.86x，与记录不符。新的确定性记录值：**0.898 @ size 29, fixedDt 1/60**。

### goldenCheck 用法（工作台页面控制台）
```js
await import('/eval-harness.js');          // 默认 DETERMINISTIC=true, CANON_SIZE=29
await __H.init();                          // 或 __H.recapture()
await __H.goldenCheck('yong-s29-dt60');    // 比对当前 H.ours；返回 {identical, diffPixels, perStroke:[{s, identical, diffPixels, oursPx, goldPx}]}
await __H.goldenCheck('yong-s29-dt60', true); // 先 recapture 再比对
// 换笔宽：__H.CANON_SIZE = 26; __H.resetSandboxes(); await __H.recapture(); await __H.goldenCheck('yong-s26-dt60');
// 实时分布对照：__H.DETERMINISTIC = false; await __H.recapture();  （隐藏标签页里一次约 7~50s，勿并发）
// 更新基线：await __H.saveGolden('name') → 把返回的 exports/export-*.png 移到 golden/<name>-{whole,s1..s5}.png
```
渲染代码改动后，goldenCheck 不 identical 即说明输出变了；diffPixels 给出改动规模，再看 IoU 判断好坏。
