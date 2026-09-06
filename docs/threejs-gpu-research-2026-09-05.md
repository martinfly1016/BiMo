<!-- 生成说明：2026-09-05 由 Claude Code 调研工作流生成（7 个代理：three.js 能力 / GPU 水墨先例 / iPad Safari 平台事实 / 代码契合度 四路并行 → 综合 → 对抗批评 → 修订 v2）。回答用户问题"three.js 是否对模拟有帮助"。所有毫秒数与阈值为估算，真机数据待 probe.html。 -->

# three.js 对 bimo「接近真毛笔」有没有帮助——结论报告 v2

> v2 说明：吸收对抗审阅清单中成立的意见后修订。保持 v1 的七节结构，但把重心从"GPU 平台学"挪回"真实感差距在哪、three.js 能否触及"；平台细节压缩为 §4 的附录式条目；所有推算数字标注"估算"；末尾新增第 8 节列出未采纳的批评及理由。核对用的本地事实：`exports/` 下只有 export-*.png、没有任何 probe-*.json；仓库根目录当前没有 sample1/sample2.mp4（提交 b584333 "本地保留"，memory 记录曾误删）；`golden/CHANGELOG.md` 证实基线由隐藏标签页 + MessageChannel 调度（即 Mac Chrome）生成、掩膜为 alpha>60 阈值化二值图。

## 1. 一句话回答

three.js 对**模拟本身**（毫束物理、墨在纸上的行为）没有帮助——它是 3D 场景图渲染库，不含任何毛笔或墨的模型。它对**渲染**的潜在帮助有三处"更好"（像素级飞白白丝、不依赖 blur 的距离场晕层、逐像素阈值的纤维状羽化边）和两处"只有 GPU 能做"（全幅流体扩散、逐毫渲染），但这五项都不是你现在"不像真毛笔"的原因：按 docs/project-review-2026-09-05.md §2.1 的评级，现状约五成，差距**全部在形态层**（腹背不对称、刃口、驻笔加粗、笔锋姿态），而且纸张模型与笔内墨量渐枯在当前代码里是**零实现**（review §1.3 #2、#3、#6）。这些都属于 CPU 上的 BrushPhysics，与渲染平台无关。three.js 唯一对口的角色是把毛笔头画成可见的 3D 物体帮助校准，它排在物理层有真实状态之后，且先做 2 小时的 2D 投影版。现阶段的正确动作是：留在 canvas 2D，先去 iPad 真机跑探针，然后做 deferRebuild 与 BrushPhysics；增量重建在 M3a 分带之前完成。

## 2. three.js 能给什么、不能给什么

### 2.1 先定位差距：现状里什么是零，什么是有

回答"three.js 是否有助于真实感"之前必须先说清差距在哪，否则会把平台问题与形态问题混在一起。按 review 与代码：

- **纸在现状里对墨迹零影响。** paper.absorb 被 main.js:41/:141 写入，但 brush.move 收到 paper 形参后函数体从不引用；paper.grain 与 grainAt（paper.js:8-19、:42-46）没有任何调用者（review §1.3 #2、#3）。
- **笔内墨量零渐枯。** 含墨量只映射为整笔透明度 `_tone() = min(0.92, 0.62 + 0.3·ink)`（brush.js:259），且 `_strokeInk` 在 begin 时快照（brush.js:78），一笔之内不变。飞白当前是零基础（review #6）。
- **形态层手写全部缺失。** 手写通道 opts 为空、butt 未传、无驻笔驱动（review §2.1），"无回弹、无锥形笔头概念"指的就是这一层。
- **质感层已经在。** 噪声、积墨、顿笔斑、晕层在手写与脚本通道对等（review §2.1）。

结论：用户感到的"差得远"来自形态层与纸/墨量两块 CPU 侧建模空白，不来自光栅器。这框定了后文对 three.js 的全部评价。

### 2.2 三个层面逐一对照

**物理真实（毫束模型）：不能给。** three.js 本身零物理，官方附带的 RapierPhysics／AmmoPhysics／JoltPhysics 都是刚体引擎薄封装，没有软体、布料或毛发。规划中的 BrushPhysics（锋尖＋笔腹两点、一阶弛豫、铺毫滞回、倾角→侧锋）只能自建。两条独立事实分开写：bimo 自家两点模型每样本约几百次浮点运算，M2 验收线 0.05 ms/事件（材料 D）；学术上最贴近的 Chu & Tai 2004 用约束能量最小化求毫束平衡态，在 2002 年的 1GHz Pentium-III 上已 25fps 实时（材料 B）——两者算量不同，但都说明物理层不需要 GPU。（出处：three.js examples/jsm/physics/RapierPhysics.js；rapier.rs；cse.hkust.edu.hk/VCB/PG02.pdf；Chu & Tai, IEEE CG&A 2004）

**墨性真实（飞白、洇墨、叠墨、纸纹）：能给"管线样板"，不能给"算法"。** 可借用的只有四件部件：GPUComputationRenderer（浮点纹理 ping-pong 骨架，官方示例仅波动方程、鸟群、原行星）、ShaderMaterial 的自定义混合状态（可表达 Porter-Duff）、InstancedMesh（千级毫印迹一次绘制）、GaussianBlurNode。扩散、渗流、沉积、分丛的数学全部要自己写。且这些部件在 WebGLRenderer 与 WebGPURenderer 两条路线上互不兼容：后者不支持 ShaderMaterial／onBeforeCompile／EffectComposer，必须改用 TSL；TSL 的 compute 在 WebGL2 回退后端上是 transform feedback 模拟，无 storage texture 与原子操作，"场扩散写纹理"在回退设备上静默不跑。（出处：threejs.org/manual/en/webgpurenderer.html；src/renderers/webgl-fallback/WebGLBackend.js；three.js issue #27642）

**可视化（看见笔头）：这是它对口的用途，但要放对位置。** 正交相机与画布像素对齐，LatheGeometry 生成锥形毫束，按 Pencil 的 altitude／azimuth 倾斜、按 BrushPhysics 的锋尖滞后与铺毫记忆做顶点位移，接触斑投影与缎带此刻的 wl／wr 重合。它不改变墨迹一个像素，对金掩膜零风险；提升的是姿态→墨迹因果的可读性与校准效率，**不是墨迹本身的真实感**。前置条件是 BrushPhysics 已有真实状态（T、W_hyst、分笔深度），否则画的是空壳；先按 M2 计划做 2D 投影版（椭圆接触斑 + 倾斜锥体剪影 + 锋尖与 handle 分离，约 2 小时，零依赖），3D 版是体验过 2D 版之后的可选打磨。它的隐藏成本要计入：第 4 张 WebGL 画布需处理 webglcontextlost、后台恢复、透明合成与 Pencil 事件穿透（pointer-events:none，输入仍走 input.js:150 的 overlayCanvas），估 8～16 小时是含这些在内的数字（材料 D）。这与用户 memory 里"毛笔本体物理化比字形调优紧急"的优先级一致：可视化服务于物理化，不抢它的时间。

### 2.3 代价

包体（min／gzip）：three.module（WebGL 全量）356 KB／86 KB；three.webgpu 616 KB／173 KB（官方 size bot，PR #32240）；npm 全包 726 KB／182 KB（bundlephobia）。D 方案若走 three/webgpu 入口即 173 KB gz。two月一版、无 LTS、常有破坏性变更，WebGPURenderer 官方仍标 experimental。对 bimo 这种无构建、GitHub Pages 直发的形态，场景图、相机、材质系统对一条"2D 全屏 pass ＋ 一条动态几何"的管线是负担。对比：twgl.js 78 KB／23 KB，裸 WebGL2 为 0。

## 3. 前人怎么做毛笔与水墨，对我们最有价值的启发

按用户"毛笔真实性优先"的指令，先列物理层线索，再列墨性层。

### 3.1 物理层：直接回答"如何更像真毛笔"

**塑性与纸孔阻力（Chu & Tai）。** 湿笔起笔后不完全回弹（塑性）；斜锋推笔时笔尖被纸孔"卡住"产生涩笔。对应 bimo：铺毫滞回 W_hyst 应有不对称的回弹常数（铺开快、收回慢），逆锋推笔时锋尖位移滞后并加抖动。（出处：PG02.pdf；IEEE CG&A 2004）

**各向异性摩擦（Baxter & Lin）。** 推比拉更易被纸牙卡住。对应：顺锋与逆锋给不同的锋尖滞后系数，这是"逆锋起笔厚、顺锋收笔尖"的物理来源之一。（出处：gamma.cs.unc.edu/DAB；Baxter "Versatile Interactive 3D Brush Model"）

**应力事件触发分丛 + 用真迹自动调参（Xu Songhua）。** 内应力超阈值才分裂成 k=⌊stress/tre⌋ 簇、面积守恒；用训练样本自动标定参数。后者与 bimo 的金掩膜／IoU／叠合评估同构：BrushPhysics 的参数（弛豫常数、滞回、倾角增益）可以拟合到 sample 真迹的逐笔掩膜，而不是手调。（出处：i.cs.hku.hk/~songhua/e-brush/paper95.pdf；EG 2003）

**少数引导毫 + 插值。** Baxter 数百毫毛只模拟一部分；Adobe Wetbrush 专利 225 根中 21 根做质点弹簧；Xu 用 <10 个原语表现上万簇。bimo 两点模型就是 2 根引导毫，飞白时加到 5～8 根虚拟引导毫沿宽度排布即可。（出处：patents.google.com/patent/US10489937B2）

**Pencil 在玻璃上零摩擦，所有速度阈值要重标定。** review §2.4 指出用户在 Pencil 上会比真毛笔写得更快更轻，飞白临界速度、拖行滞后若按文献或真笔标定会"处处飞白"；手写通道必须按用户自己的手写速度分布校准。这条比任何渲染讨论都更影响"像不像"。

**Zen Brush 2/3（PSOFT）是最接近目标设备的商业参照。** iPad 上的东亚毛笔 3D 模型、Pencil 压力与倾斜、洇／晕、三种干燥模式（自然干／快干／立即干）。它证明书法级体验不需要 Expresii 那种 CFD；其"立即干＝冻结 wet 场"按钮对金掩膜复现有直接工程价值（评估时冻结时间维度）。（出处：psoftmobile.net/en/zenbrush3.html）

### 3.2 墨性层

**物理在 CPU、足迹在 GPU 的分工从 2002 年就定型。** Chu & Tai 与 Baxter 都是 CPU 求毫束平衡态，GPU 只光栅化足迹；Wetbrush 引导毫在 CPU、密度场在 GPU。与 bimo 双轨天然吻合。

**飞白两条路线，先做便宜且确定性好的。** Chu & Tai 用 alpha 剖面（split map × dry map，动态阈值）；Xu 用几何分裂。前者对应 bimo 的"沿宽度方向一维 alpha 剖面裁剪缎带"，后者对应"子缎带"。FITEE 2019 综述把两者并列为标准做法。Procreate、InkField FLYING 模式用颗粒噪声后处理伪造飞白，没有锋尖轨迹与铺毫的因果——对书法细节高敏感的用户是反面参照。（出处：FITEE 2019 综述 10.1631/FITEE.1900195；help.procreate.com Brush Studio；ileivoivm.github.io/inkField/tech）

**洇墨是"收笔后 0.5～2 秒在窄域内演化再冻结"，不是一次性 blur。** Shi & Zhou 批评全画布 Navier-Stokes 过度扩散，改为每笔只在中心线 ± 宽度的窄域解泊松；InkField 抬笔后驱动力衰减但墨继续走；inkwash 的 wet 场按 2～18 秒指数蒸发，决定后一笔叠上去是融合还是覆盖。bimo 现在的晕层是各向同性高斯（且半径仅 ≈0.93px，见 §4），改成"笔画包围盒 × 1/4 分辨率 Float32Array 上、按 grain 调制的各向异性扩散跑几十步、rAF 分帧演化"在 CPU 上成本很低。（出处：shizhezhou.github.io/projects/dynamicBrush；johnowhitaker.github.io/inkwash/about）

**纸是参数场，而现状连贴图都没接。** Guo & Kunii 的纤维阻碍、MoXi 的渗透率、Rebelle 的"纸结构决定颜料行为"、2012 浙大工作的随机数纹理都指向：grain 应同时作为枯笔先断处的阈值、扩散系数 D(x,y) 和最终合成纹理。第一步不是选算法，而是把 paper.grain 烘成一张 alpha 画布并让 brush.move 真正读 paper.absorb——这两条在 review 里是"死参数"，M3a 之前就该接上。

**光学叠墨与边缘变暗。** inkwash 用 Beer-Lambert（color = paper·exp(−density·k)）累加密度再取指数；Curtis 1997 的 edge darkening 与 inkwash 的 1+1.35·|∇density| 都是"按梯度加深"。bimo 的 _inkDeposit（镂空→blur→destination-in 裁回）本质是 Curtis 边缘变暗的 canvas 2D 实现，方向正确，只需把强度与局部墨量／驻留时间挂钩并按 grain 调制。**限定词：** 叠墨加深只适用于黑墨模式；朱砂模式现在的语义是"抠底后重涂、交叠不加深"（brush.js:_composite 注释，物理饱和），review §4 明说改红墨交叠语义会动 0.900 的像素基础，且用户未反馈问题，不改。

**Web 端先例的横向事实（措辞收窄）：** 本次调研到的 Web 端场模拟先例（PavelDoGreat、inkwash 约 1000 行单文件、gpu-io、David Li Fluid Paint、rafaelanderka LBM）均未使用 three.js；调研到的唯一 three.js 案例 Qalam 用它显示 Tilt Brush 导出的笔触网格，不做模拟。这与"2D 场模拟用不上场景图"的判断一致，但不是全称结论。

## 4. iPad Safari 上的现实约束

本节只保留直接影响现阶段决策的事实；GPU 立项时才需要的平台细节压到 4.4 附录。

### 4.1 帧预算与输入

iPad Air 13 (M2) 是 60Hz 屏、无 ProMotion、9 核 GPU（binned M2）、8GB、CSS 视口 1366×1024、dpr=2（support.apple.com/119893；docs/ipad-setup.md 表）。rAF 上限 60Hz，帧预算固定约 16.7 ms；Pencil Pro 240Hz 采样在每个 pointermove 里以约 4 个 coalesced 样本到达——这是 §5 "每帧 4 次重建只上屏 1 次"的来源。iPad 联调基础设施已就位（提交 d8f7572：server.js --lan、/save-json、docs/ipad-setup.md），探针数据回传路径存在，跑探针的门槛是"打开一个页面"。

### 4.2 canvas 2D filter：预期在 iPad 上未启用，待探针确认

WebKit 于 2024-04 实现 Canvas Filters（bug 198416），但 UnifiedWebPreferences.yaml 中 CanvasFiltersEnabled default=false、status=testable；caniuse 显示 Safari 至 26.x 仍"Disabled by default"，26.0～26.4 功能说明均未提及转正。brush.js:280-282 与 :321-325 的 `if (ctx.filter !== undefined)` 守卫会静默跳过。**预期**在你的 iPad 上这两层未渲染，但这是文档推断，未经真机确认（v1 在正文断言、在 §7 又说待落盘，v2 统一为"预期，待确认"）。

两层的实际量级要分开说：晕层 blur 半径 = max(0.5, 29×0.032) ≈ 0.93px、alpha = tone×0.18 ≤ 0.166，是亚像素级的一层，缺失后视觉差异很小；真正可见的是积墨内缘 blur（max(1.2, 29×0.085) ≈ 2.47px，alpha tone×0.9，brush.js:279-281）。"iPad 上缺两层质感"应读作"缺一层可见的、一层近乎不可见的"。

探针项 `canvasFilter: 'filter' in ctx`（probe.html:164）只测属性是否存在，不能证明 blur 生效——若 WebKit 暴露属性但特性关闭时忽略赋值，`'filter' in ctx` 为 true、守卫进入、blur 却不生效。探针要加功能测试：画 1px 点 → filter blur(2px) → 读邻像素 alpha 是否 >0。

### 4.3 对金掩膜体系的影响

金掩膜不是原始像素：eval-harness.js:68-76 把 600px 画布中央 84% 区域缩放到 500² 后按 alpha>60 阈值化为二值图（golden/CHANGELOG 同）。这有两面：阈值化对亚像素差异更鲁棒，所以跨设备结论从"几乎必然 identical=false"降为"很可能不 identical"；但 drawImage 缩放的重采样核在 Skia 与 CoreGraphics 不同，是第二个跨设备差异源（第一个是边缘 AA）。golden/ 基线确定是在 Mac Chrome 隐藏标签页 + MessageChannel 调度下生成的（CHANGELOG 明记），元数据应补记 UA/OS/GPU。

结论三层：一，Mac Chrome 生成的 golden/ 在 iPad Safari 上很可能 identical=false，即便渲染逻辑一字未改；二，Safari 2D 画布（CoreGraphics 在 GPU Process 回放 DisplayList）是否严格逐次 bit-exact 没有官方声明，所以"identical 模式限定同机 + 同 OS + 同浏览器"在 iPad 上成立与否本身要验证——探针任务里加"iPad 上两次确定性 recapture 逐像素 diff"；三，GPU 渲染在同机同版本内实践上一致，但无规范或库承诺（three.js 自己的截图测试用 pixelmatch 阈值 0.1、允许 0.1% 像素差、跑软件光栅器并排除 60 多个 GPU discrepancies 示例），一旦换光栅器，brush.js:202 的 0.6px 描边外扩消失、每个边缘像素 AA 都变，0.900 是在这套光栅化下调出来的，整字 IoU 会漂移（估算 0.005～0.02，待实测），strokes.js 需要重调。因此 identical 只能守在 canvas 2D 几何通道；GPU 层（若有）用容差指标另守。（出处：three.js test/e2e/puppeteer.js；docs.vulkan.org invariance 附录；thumbmarkjs.com canvas fingerprinting）

零成本项：eval-harness 与掩膜画布的 getContext('2d') 加 `{ willReadFrequently: true }`（Safari 18+ 支持），避免 GPU Process 加速画布来回搬运。

### 4.4 附录：GPU 立项时才需要的平台事实

- **WebGL2**：Safari 15 起默认开启，经 ANGLE→Metal。EXT_color_buffer_float 已在 iOS 暴露；RGBA16F／R16F 全路径可渲染、可混合、可 resolve，是墨量累积最稳格式；32 位浮点线性采样受 supports32BitFloatFiltering 门控，iPad Air M2（Apple8）大概率支持但需真机确认。主线程最多 16 个上下文、Worker 4 个，超出丢最旧（WebKit WebGLRenderingContextBase.cpp:192-193）。ANGLE-Metal 怪癖：`flat` 插值触发昂贵变通、getParameter/getError 意外昂贵、UBO 上传时机不对可致 150 ms 卡顿；antialias:true 在 iOS 16.1～16.4 曾失效；iPadOS 15.4 与 17 都出现过 WebGL 回归，GPU 路径必须可降级。（出处：webkit.org/blog/11989；ANGLE mtl_format_table_autogen.mm；WebKit bug 238196、262628；wonderlandengine.com Safari 性能文）
- **WebGPU**：iPadOS 26 起默认开启，含 compute，绑定 OS 版本而非仅 Safari 版本；WGSL→MSL 默认 relaxed fast-math，数值确定性比 WebGL 更难谈。（出处：webkit.org/blog/17333；WebKit ShaderModule.mm:62-80；gpuweb #2076）
- **回读**：从自己的 FBO 经 PIXEL_PACK_BUFFER + fenceSync 异步读（WebKit bug 235002 记录直接 readPixels 约 3 倍开销）；WebGPU 用 copyTextureToBuffer + mapAsync。
- **带宽与功耗（估算）**：Apple GPU 是 tile-based deferred renderer，瓶颈是全幅纹理带宽与 pass 数而非算力。dpr2 全幅 2732×2048 RGBA16F 一张约 45 MB，一个 pass 读+写约 90 MB，10 pass/帧 @60Hz ≈ 54 GB/s 量级——对 M2 已是可感负载，"算力绰绰有余"只对 ALU 成立。**v1 说"GPU 每帧跑 pass 比 canvas 2D 更耗电"没有数据支撑，v2 撤回该方向性判断**：推荐路线自己也把 drawOverlay 改为 rAF 节流、收笔后 rAF 演化 wet 场，canvas 2D 路径同样逐帧；Safari 2D 画布是 CoreGraphics CPU 光栅，逐帧全幅 blur 未必比一次 GPU pass 省电。两边都需要测量：perf.html 加"每笔能耗代理"（帧时间×帧数，或 iPadOS 电池读数），并观察 20 分钟持续书写的热节流。
- **内存**：dpr2 全幅每张 RGBA 画布约 22.4 MB；iOS Safari 2D 画布总内存有历史上限（224～384 MB），iPadOS 26 当前值未知，开 HiDPI 前先做画布预算。

## 5. 推荐方案与分期

### 5.0 前提声明

本节默认 review §5 的双轨决定（手写走物理轨、脚本守 0.900）与 A/B、1/2/3 拍板通过。memory 记录这些尚未拍板；若拍板结果不同（例如决定脚本通道并入物理轨），§5.3 的"渲染变体矩阵"与 §5.5 的 C 方案触发条件要重写。

### 5.1 现状诊断：性能问题是算法级而非平台级（全部为代码推算，真机未测）

brush.js:124 每个 move 全量 _rebuild，而 :94 的 2px 细分与 :109 的 0.6px 合并规则使 240Hz 输入下正常手写速度时脊点数 n 约等于原始样本数：1.5 秒一笔约 360 点，6 秒行书连笔约 1440 点。每样本全量重建使一笔总绘制四边形数为 n²/2，6 秒行书笔约 100 万个四边形，任何光栅器都扛不住这个算法。input.js:203-209 展开的每帧约 4 个合并样本各触发一次重建，但 drawOverlay 每个 pointer 事件才调一次，四分之三的重建结果从未上屏。唯一真正的逐像素成本是 _composite 每帧全幅 blur 与 3 次全幅 drawImage（brush.js:317-328，dpr=2 下估 8～20 ms/帧）。

增量重建的正确表述（修正 v1）："同色 source-over AA 覆盖合成 1−(1−a₁)(1−a₂) 在精确算术下可交换"是数学事实，但 strokeCanvas 是 8 位预乘存储，不同顺序合成会有 ±1 LSB 舍入差，而 strokeCanvas 随后被当掩膜用（_inkDeposit 的 destination-in／out、_composite 主体），1 LSB 会传导到 inkCanvas。另外 brush.js:109-114 的驻笔分支会**原地改写已入栈最后一点**的 wl/wr/v，平滑核（:150-154）又用 i±1，所以尾部两点几何确实不稳——这是"活尾 2～3 段"的原因。因此增量重建的目标是"预期 ≤1 LSB、以等价测试为准"：写"同一 trace 全量 vs 增量逐像素 diff"测试，diff=0 则两通道皆可用；非零则手写通道接受该容差、脚本通道不启用。结论不能先于测试。

增量重建的工程量比材料 D 的 6～10h 估算更多：需要持久"已落定层"+"活尾层"两张画布、_composite 多一次 blit、_dwellSpots 改增量维护、驻笔回写要能撤销活尾、刃口旋转 K=min(8,n−1) 在 n<9 区间的处理。按 1～2 天计，且在零真机数据前不承诺。

### 5.2 分期

**现在（M1，先于一切）：真机探针。** 在 iPad 上跑 probe.html 导出 probe-*.json 进 exports/，重点：canvasFilter 属性存在性 **加功能测试**（4.2）、devicePixelRatio、rAF 实测频率、coalesced 样本数；追加 gl.getSupportedExtensions()（EXT_color_buffer_float／OES_texture_float_linear／EXT_float_blend、MAX_TEXTURE_SIZE）与 navigator.gpu.requestAdapter() 的 features/limits；在 iPad 上跑一次 goldenCheck 记录与 Mac Chrome 基线的 diffPixels 作为跨设备基线，再做两次确定性 recapture 互比确认 iPad 同机是否 bit-exact。这些是所有文档都无法替代的数字，也是后面每个毫秒数的校准点。

**现在（M1/M2）：确定收益的算法修正。** deferRebuild + flush（每 rAF 只重建一次，约 2h）、drawOverlay 改 rAF 节流、删掉 overlay 上无效的 destination-out。这三项不依赖真机数据、对金掩膜零风险（脚本通道走 player 固定步长，不经 deferRebuild）。

**M2：物理层优先。** BrushPhysics 全在 CPU：两点模型、一阶弛豫、不对称铺毫滞回、顺逆锋不同滞后系数（3.1）、按用户手写速度分布重标定阈值；让 brush.move 真正读 paper.absorb、把 grain 烘成 alpha 纹理（先接上，M3a 再决定怎么用）。笔头可视化先用 2D 投影（2h）。toPenTrace 对照与 §6 的物理 A/B 是本期验收。three.js 3D 笔头（D）在物理状态稳定后作为可选项。

**M2 末 / M3a 之前：增量重建。** 不以 p95 为门槛——它是 M3a 分带的前置（每段拆 16～48 个子四边形时，全量重建在 n=300 上每次约 1 万次 fill，不可用），无论现在帧时间如何都要在分带之前做完。只在手写通道启用，脚本通道走原全量路径，等价测试通过后再决定是否对脚本通道打开并由 goldenCheck 兜底。

**手写通道的 blur 处置（限手写通道）。** 积墨内缘的 2.47px blur 改为自实现（drawImage 降采样金字塔或多次 box 近似），让 iPad 能看到这一层；晕层不再用 blur 而按 M3a 设计改为几何外扩缎带 + 固定小半径柔边（0.93px 的半径本来就无法用 1/2 分辨率金字塔逼近，最小实用模糊约 1～2px，近似会改变半径语义）。**脚本通道保留原 filter:blur 与全幅操作不动**——换 blur 实现会挪动阈值边界像素，等于重生成 golden/，与"脚本通道一行不碰"冲突；包围盒限定的 blur 在 Safari 上子矩形边界取舍也可能改动 alpha≈60 附近个别像素（材料 D），同样只用于手写通道。这意味着 Mac 与 iPad 在手写通道走"同一算法"，但不是"同一像素"（Skia 与 CoreGraphics 的重采样核不同），v1 的"同一条像素管线"是过度承诺。

**M3a：墨性层在 canvas 2D 实现。** 飞白用一维 alpha 剖面裁剪或 3～5 条子缎带（Krita 纯 CPU 多毫毛引擎是可行性证据）；叠墨加深**仅黑墨模式**用原生 multiply 加 overlay 的 CSS mix-blend-mode 保证预览与落墨同规则，朱砂模式保持抠底重涂；驻笔洇环用 radialGradient 加 grain destination-in；晕层用几何外扩缎带；纸纹烘成 alpha 纹理。要说清一个已知差距：canvas 2D 没有逐像素阈值比较，"coverage>grain 才留墨"的硬阈值纤维边只能用 3～4 层不同 alpha 的 destination-in 近似，效果偏柔化而非纤维——对边缘细节高敏感的用户这是可感差距，是 GPU 三处"更好"里最可能先被要求的一处。

### 5.3 渲染变体矩阵与维护成本

推荐路线实际造出三条渲染变体，而非一句"双轨"能概括，每条有自己的回归口径：

| 变体 | 重建 | blur | 像素基线 | 回归口径 |
|---|---|---|---|---|
| 脚本通道（永字） | 全量 _rebuild | 原 filter:blur 全幅 | Mac Chrome golden/ | identical（同机同版本）；iPad 上另记容差基线 |
| 手写通道 | 增量（活尾 + 落定层） | 自实现，包围盒 | 无逐像素基线 | 与沙箱回放 IoU≥0.99；笔法特征逐条对照 |
| GPU 后效层（若有） | — | 距离场，无 blur | 无 | 容差（diffPixels 上限或 IoU≥0.995，阈值估算待校准）+ 笔法特征对照 |

再乘以 Mac／iPad 两条像素管线。每次改 _composite 要跑两到三套验证，这是双轨的真实价格；如果拍板结果是脚本通道并入物理轨，矩阵可收缩为一行。

### 5.4 引入 GPU 的触发条件（任一即触发；阈值为估算，待 perf.html 真机数据校准）

一，上述优化做完后 perf.html 在 iPad 上 p95 帧时间 dpr1 超过 12 ms 或 dpr2 超过 16 ms（估算阈值）；二，你看过 M3a 的带状飞白或近似纤维边后判为"梳子感／贴图感／过柔"并要求丝状或纤维状细节；三，你明确要生宣式湿墨交融、笔画相遇处晕染、各向异性纤维扩散。

### 5.5 若引入，选什么

不选 three.js 做墨迹管线。GPU 层有两种明确不同的架构，v1 混为一谈，v2 分开：

- **(a) 位图后效**：吃 canvas 2D 画出的覆盖率位图（每笔收笔时 texImage2D 上传一次，或书写中只上传脏包围盒 texSubImage2D；若每帧全幅上传，600² 1.4 MB/帧、dpr2 5.8 MB/帧，成本与它想替换的 blur 同量级，材料 D），GL 侧做湿度场扩散、纸纹阈值羽化、叠墨。**做不了 UV 飞白**（位图已丢失弧长／跨宽参数化）。
- **(b) 几何重光栅**：GL 侧消费 BrushPhysics 的 {x,y,wl,wr,法线,墨量,湿度} 序列自己光栅化带 UV 的三角带，能做像素级白丝与距离场晕层，但手写通道会同时存在 canvas 2D 缎带（给掩膜／评估）和 GL 缎带（给外观）两套光栅器，边缘不一致——这已是 C 方案的一半（C-lite），沙箱 renderTrace 必须跑同一 GL 管线（M1 的"live 掩膜 vs 沙箱回放 IoU≥0.99"才比的是同一支笔），且 Safari 16 个上下文上限迫使沙箱共享单个 GL 上下文。

触发条件一或三选 (a)，触发条件二直接评估 (b)，不补 (a)。实现用裸 WebGL2 单上下文多 FBO（inkwash 全部约 1000 行，与无构建纯 ES module 形态一致）或 gpu-io 薄封装；墨量累积 RGBA16F，扩散场 R32F + NEAREST 避开 float_linear 依赖，antialias:false，几何决定路径不用导数与超越函数；若 iPadOS 26 可作前提，WebGPU 优先、WebGL2 回退。只有一种情况用 three.js：D 方案的 3D 笔头已引入它，此时复用其 WebGLRenderTarget 保持单一依赖。

**整体迁移（C）** 只在两个条件同时成立时考虑：M2 的 toPenTrace 对照证明物理层能复现②③刃口且你拍板脚本通道并入物理轨（届时 strokes.js 与金掩膜本来就要重建）；以及 M3a 已证明确实需要像素级白丝或全幅扩散。缺一则不做。

## 6. 最小可感实验

用户的验收口径是"叠合能重合"与"笔法特征逐条对照"（memory），最紧急的是毛笔本体物理化。因此最小可感实验分两个，顺序不可颠倒。

**实验一（M2 内，首要）：物理层 A/B。** 同一段 Pencil 轨迹（用 PenInput 录制的 PenTrace，含 altitude/azimuth/pressure/240Hz 样本），左版用现有设计式缎带（opts 为空的手写通道），右版用 M2 BrushPhysics 产出的 {x,y,wl,wr}，两版都走同一条 canvas 2D 渲染管线，然后与真迹叠合。逐条看：铺毫后腹背是否不对称、侧锋时上缘薄下缘厚是否随倾角出现、驻笔是否加粗、收尖是否随速度与提笔出现、逆锋起笔是否比顺锋厚。这才是"像不像真毛笔"的 A/B——渲染管线在两版间不变，差异全部归因于形态层。工作量在 M2 本身之内，不额外占时。

**实验二（M3a 之后，可选）：GPU 渲染 A/B。** v1 把它放在现在做，与 M2 竞争时间，且右版"按 v 查 16 列毫带墨量纹理"在 M2 之前没有任何真实 a_i 数据，只能用编造的墨模型，测的是"编造墨模型 + GPU"而不是 GPU 收益；v2 后置。做法：取 M3a 已产出的、带毫带墨量 a_i 的 PenTrace，左版是 canvas 2D 管线加自实现模糊与近似纤维边（即 iPad 上实际能看到的样子），右版用裸 WebGL2（约 400 行：单上下文、正交全屏 quad、两张 RGBA16F ping-pong RT）把同一序列写成带 (u,v) 的三角带，片元着色器做三件事——按 v 到边缘的距离 smoothstep 出晕层（无 blur）、按 v 查毫带墨量 1D 纹理出白丝、按 paper.grain 做阈值羽化——再在收笔后 1 秒内对 wet 场跑各向异性扩散并冻结。三条腿各留开关。参照选择：飞白丝用 sample2 行书的反捺快笔（sample1 楷书朱砂几乎无飞白，无真值）；顿笔积墨与晕层用 sample1 的顿笔出锋段。素材现状：仓库当前无 mp4，需从本地副本取帧。验收用叠合与逐项对照：白丝是否连续细丝而非量化条带、晕层是否随宽度变化而非等宽、顿笔积墨是否比行笔段深、羽化边是否纤维状而非柔化；同时记录 iPad 上两版每帧耗时与收笔一次性耗时。若只有"白丝"一项明显更接近真笔，只为飞白考虑 (b) 缎带 UV；若三项都无感，GPU 化关闭。

## 7. 不确定项

- 真机数据完全缺失：exports/ 下没有任何 probe-*.json（只有 export-*.png），本报告所有毫秒数、"4 个合并样本/帧"、IoU 漂移 0.005～0.02、p95 触发阈值均为推算或估算。
- iPad 上 canvasFilter 是否为 false，以及属性存在时 blur 是否真正生效（4.2 功能测试待做）。
- Safari 2D 画布（GPU Process 回放 DisplayList）是否逐次 bit-exact 无官方声明；iPad 上同机 identical 是否成立待两次 recapture 验证。可以肯定的只有 Mac Chrome 生成的金掩膜在 iPad 上很可能不 identical。
- 增量重建与全量重建的实际像素差（预期 ≤1 LSB）待等价测试；若非零，脚本通道不启用。
- iPad Air M2 是否暴露 OES_texture_float_linear 与 EXT_float_blend：ANGLE 条件与 Apple 特性表指向支持，无该机型直接测量。
- Safari 26 在该机型上的 WebGPU features/limits 只能真机 requestAdapter 查。
- iPadOS 26 Safari 上 drawImage(WebGL canvas → 2D canvas) 与 transferToImageBitmap → bitmaprenderer 的实际成本无当前版本测量。
- 功耗：canvas 2D 逐帧 CPU 光栅 vs GPU pass 哪个更省电没有任何一方的数据；持续书写 20 分钟的热节流风险未测。
- Apple 是否会把 Canvas Filters 转为默认开启：状态仍 testable，26.0～26.4 未提及，Safari 27 beta 未查证。
- iPadOS 26 / 8GB 机型的 Safari 2D 画布总内存上限当前值未知（历史 224～384 MB）。
- sample1/sample2 素材：仓库无 mp4，"sample1 几乎不洇、sample2 飞白连笔为主"的判断来自 review 与 memory 记录，能否复核取决于本地副本是否完好。
- review §5 的双轨与 A/B、1/2/3 决定尚未拍板；本报告 §5 的分期与矩阵以其通过为前提。
- three.js WebGPURenderer 的 WebGL2 回退 compute 能力边界随版本快速变化（issue #27642 可能已部分改变），不影响"不用 three.js 做毛笔本体"的结论。

## 8. 未采纳的批评及理由

1. **#36 按新方案重排章节。** 未在形式上采纳：本次修订的约束是保持 v1 七节结构。已在内容上采纳——§2 开头新增"先定位差距"，§3 物理线索前置，§4 压缩为决策相关事实 + 附录，§6 以物理 A/B 为首要实验。若后续允许改结构，建议按批评的顺序（一句话答案 → 差距在哪 → 算法修正 → GPU 何时值得 → 附录）重排。

2. **#33 "先测 p95，再决定只做 deferRebuild 还是上增量"。** 部分未采纳。deferRebuild 与 drawOverlay 节流现在就做（不依赖数据、零风险），这点一致；但增量重建**不以 p95 为门槛**——它是 M3a 分带的前置条件（分带后全量重建每次约 1 万次 fill，与当前帧时间无关），所以排在"M3a 分带之前必做"，而不是"看 p95 再说"。已采纳的部分：从"现在约 2 天"改为"M2 末，1～2 天，零真机数据前不承诺"。

3. **#16 "B 方案每帧 texImage2D 上传与 blur 同量级"。** 部分采纳。已把该成本写入 §5.5(a)；但材料 C 与 D 都指出上传可以"每笔一次"或"只传脏包围盒 texSubImage2D"，不是必然每帧全幅，所以不接受"B 的性能收益被上传抵消"的整体结论。B 被否定的真正理由是它做不了 UV 飞白（已写）。

4. **#30 的反向暗示"CPU 全幅 blur 可能比 GPU pass 更耗电"。** 采纳其"v1 的方向性判断无数据"的批评并撤回原句；不采纳反向结论，两边都无数据，v2 改为给出带宽估算并要求 perf.html 加能耗代理后再判。

5. **#23(c) "sample1 不适合做对照"。** 部分采纳。飞白丝改用 sample2 反捺快笔（已改）；但 sample1 的顿笔出锋段对"积墨是否比行笔深、晕层是否随宽度变化"两项仍是有效真值，保留作这两项的参照。

6. **#5 关于 Qalam 的反例。** 采纳措辞收窄，但注明 Qalam 用 three.js 只做笔触网格显示、不做模拟，因此收窄后的陈述（本次调研到的 Web 端场模拟先例均未用 three.js）仍成立，不影响结论。

7. **#1 对 Chu & Tai 算量"远不止几百 flop"的定量说法。** 采纳"分开写"的要求，但 v2 不对 Chu & Tai 的每样本算量给任何数字（材料中没有），只写"2002 年 CPU 上 25fps 实时"。

8. **#26 "0.93px 晕层无法用金字塔逼近"。** 采纳事实，但处理方式不是"找更好的近似"，而是手写通道的晕层按 M3a 设计整体改为几何外扩缎带（不再依赖 blur 半径语义），金字塔／box 近似只用于 2.47px 的积墨内缘。

9. **#24 "GPU 收益应列五处"。** 已采纳数目（三处更好 + 两处独占），但仍坚持 v1 的排序判断：这五处都不是当前差距所在，且两处独占（全幅扩散、逐毫）与用户参照相关度最低。