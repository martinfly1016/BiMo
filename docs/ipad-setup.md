# iPad 真机联调指南（iPad Air 13 M2 + Apple Pencil Pro）

目的：把 bimo 工作台开到 iPad Safari 上，用 `probe.html` 摸清这台设备实际给到网页的输入能力，再进主页手写。
两条路：**方式一**——Mac 上 `node server.js --lan` 走局域网（第 1、2 节，导出直接落到 Mac 的 `exports/`）；**方式二**——打开 GitHub Pages 在线版（第 1b 节，HTTPS、无需同一 Wi-Fi，导出改为系统共享/下载）。第 3～5、7 节两条路通用。

## 0. 先记住这台设备的硬事实

| 项 | 事实 | 对我们的含义 |
|---|---|---|
| 屏幕 | iPad Air 13 (M2) 是 **60Hz** 屏，无 ProMotion | `requestAnimationFrame` 上限 60Hz；`pointermove` 每秒约 60 次 |
| Pencil 采样 | Apple Pencil Pro 硬件 240Hz | 60Hz 屏下每个 `pointermove` 应带约 **4 个合并样本**（`getCoalescedEvents()`） |
| 倾角 | `PointerEvent.altitudeAngle / azimuthAngle` 需 **iPadOS Safari ≥ 18.2**；更早版本只能从 Touch Events 的 WebKit 私有字段 `Touch.altitudeAngle / azimuthAngle / touchType` 拿 | 探针页两条路都测 |
| 悬停 | Pencil Pro 在 M2 iPad 上支持悬停，Safari 以 `buttons===0` 的 pen `pointermove` 派发 | 可做「落笔前预览」 |
| 压感 | `pressure` 0..1 | 第一条 `pointerdown` 的压力常常偏小/为 0，探针会记录 |
| **Web 不可用** | Pencil Pro 的 **挤压（squeeze）**、**双击切换工具**、**筒身旋转（barrel roll / twist）** 在 Safari 网页里默认拿不到（`twist` 基本恒为 0，squeeze 无任何 Web API） | 不要在交互设计里依赖它们 |
| 合成事件 | 代码派发的（`isTrusted===false`）PointerEvent 上 `getCoalescedEvents()` 返回空数组 | 所有消费方在空列表时回退为 `[e]`（探针页已如此实现） |

## 1. Mac 端：以局域网模式启动服务器

1. Mac 与 iPad 连**同一个 Wi-Fi**（同一网段；访客网络 / AP 隔离 / 公司网的设备隔离都会导致连不上）。
2. 在项目目录启动：

   ```bash
   cd "/Users/yuchao/Documents/vibe coding/bimo"
   node server.js 8642 --lan
   ```

   或在 Claude Code 预览里用 `.claude/launch.json` 的 **`bimo-lan`** 配置（原 `bimo` 配置仍只监听 127.0.0.1，iPad 访问不到）。
3. 启动日志会列出所有局域网 IPv4 及可直接打开的 URL，例如：

   ```
   bimo dev server: http://localhost:8642  (listening on 0.0.0.0:8642)
     --lan: 在 iPad Safari（同一 Wi-Fi）打开：
       [en1]  http://192.168.3.9:8642/probe.html   （探针）
              http://192.168.3.9:8642/              （工作台）
       [utun4]  http://100.x.x.x:8642/probe.html   （探针）
   ```

   用 `en0/en1`（Wi-Fi）那一组；`utun*` 是 VPN/Tailscale 虚接口，iPad 不在那张网里就打不开。
4. 第一次监听 0.0.0.0 时 macOS 可能弹「是否允许 node 接受传入网络连接」——点允许。若系统设置里防火墙是「阻止所有传入连接」，需先关掉。
5. Mac 上若开着 VPN（全局代理模式）可能会劫持局域网路由；连不上时先断开 VPN 试。

## 1b. 方式二：GitHub Pages（HTTPS，无需局域网）

不用开 Mac 服务器、不用同一 Wi-Fi，随时随地能写；代价是没有 `/save-*` 端点，导出不再落到 `exports/`。

1. iPad Safari 打开在线版：`https://martinfly1016.github.io/BiMo/`（项目站点在子路径 `/bimo/` 下，页面内所有链接与资源都是相对路径）。探针页是同目录下的 `probe.html`。
2. **添加到主屏幕**（第 5 节同法）：HTTPS 站点的 standalone 模式更稳，且不会再有「不安全」提示。
3. **导出方式变了**（工作台「导出手写样本」与探针「导出结果」都一样，逻辑在 `js/export-fallback.js`，探针页内联了同一份）：
   - 页面加载时先探一次 `save-json` 端点；Pages 上没有 → 点导出时**直接弹出系统共享面板**（`navigator.share`，iPadOS 15+）：
     - 选 **AirDrop → 你的 Mac**：文件进 Mac 的「下载」，文件名 `pen-samples-<时间戳>.json` / `probe-<时间戳>.json`（与 `exports/` 里的命名同构，拷进 `exports/` 即可继续用原来的脚本）；
     - 或选 **存储到「文件」**：留在 iPad 的「文件」App，稍后经 iCloud Drive / AirDrop 拿回 Mac。
   - 若系统不支持文件共享（旧版 Safari）→ 自动改为**浏览器下载**，文件在「文件」App 的「下载」文件夹；
   - 再不行 → 复制到剪贴板 / 页面显示可全选的 JSON（通用剪贴板可直接在 Mac 粘贴）。
   - 状态文字会写明走了哪一条（"已用系统共享发送…" / "已改为下载…"）。取消共享面板 = 本次未导出，可再点一次。
   - **桌面浏览器**（Mac 上直接开 Pages，或 `localhost`）：不弹系统共享面板、也不发探测请求——先 POST，没有端点就直接下载到浏览器的「下载」文件夹。共享只在触屏设备（`navigator.maxTouchPoints > 0`）上参与，因为 macOS Safari / Chrome 在 https 与 localhost 上同样暴露 `navigator.share`，桌面用户要的却是文件直接落盘。
   - 端点判定（`serverSays`）：只有 `server.js` 自己的 400/413 原话（"Bad name…" / "Body is not valid JSON…" / "Payload Too Large…"）和已确认有服务器后的非 2xx 才按"服务器拒绝"红字报告、不回退；其余非 2xx 都视作没有端点、照常回退——GitHub Pages 回 405、`python3 -m http.server` 回 501、旧版 `server.js` 进程回 404，托管/CDN 若回 403 等意外状态码，文案会写成「端点返回 HTTP 403，已改为…」。
4. 评估体系（控制台 `await import('./eval-harness.js')`）在 Pages 上同样能跑：`ref-cell.png`、`golden/`、`js/strokes.js` 都按模块位置解析；`__H.saveGolden()` 没有服务器时回退为逐张下载 PNG（返回值 `mode:'download'`，文件名已是 `golden/` 目标名）。
5. 改了代码要 `git push` 才会更新在线版（Pages 构建约 1 分钟）；主屏幕图标打开的 standalone 没有刷新按钮，从 App 切换器上滑关掉再开。

## 2. iPad 端：打开页面（方式一）

1. Safari 地址栏输入日志里的 `http://<ip>:8642/probe.html`（注意是 **http**，不是 https；Safari 会提示「不安全」，忽略即可）。
2. 探针页用法：
   - 用 Pencil 在上半书写区**按平常姿势写 10 笔横竖**（倾角分布持续累计，这是后面「中锋零点」的依据）；
   - 点「**开始 10 秒采样**」，期间持续书写，结束后窗口冻结，得到干净的每秒事件数 / 合并样本数 / 压力直方图 / 延迟分位数；
   - 点「**静握 2 秒**」，3 秒倒计时后把笔尖轻放纸面保持不动，得到 altitude/azimuth 抖动 σ；
   - 期间顺手用手掌/手指碰一下书写区，看「掌拒绝」一栏是否计入 touch 事件；
   - 悬停：让笔尖离屏 1 cm 内移动，看「悬停」一栏是否到达；
   - 点「**导出结果**」→ JSON 直接落到 Mac 的 `exports/probe-<时间戳>.json`，页面显示返回路径。失败提示时按第 1 节检查是否用了 `--lan`。
3. 再打开 `http://<ip>:8642/` 进工作台手写。

## 3. iPad 系统设置（写字前逐项过一遍）

| 设置 | 路径 | 原因 |
|---|---|---|
| 关闭 **随手写 (Scribble)** | 设置 → Apple Pencil → 随手写 关 | 开着时在网页输入框附近落笔会被系统拿去当手写输入，笔画被吞 |
| 关闭 **从角落划动** | 设置 → Apple Pencil →「左下角划动 / 右下角划动」都设为「关闭」 | 默认从角落上划会截屏 / 打开快速备忘录，写捺、钩时极易误触 |
| 挤压 / 双击 | 设置 → Apple Pencil → 挤压、双击 | 网页里无效；怕误触可设为「关闭」 |
| 关闭 **低电量模式** | 设置 → 电池 → 低电量模式 关 | 低电量模式会压低刷新率与 JS 性能，采样数据失真 |
| 多任务手势（可选） | 设置 → 多任务与手势 → 手势 关 | 防止手掌四指/五指误触发切换 App、回主屏 |
| 自动锁定 | 设置 → 显示与亮度 → 自动锁定 → 永不（调试期间） | 长时间对照真迹不至于锁屏 |
| 悬停效果（可选） | 设置 → Apple Pencil → 显示笔尖悬停效果 | 只影响系统 UI 显示，不影响网页是否收到悬停事件 |

## 4. Safari 功能标志（Feature Flags）

路径：**设置 → App → Safari → 高级 → 功能标志**（旧版叫「实验性功能」；iPadOS 17 以前在 设置 → Safari → 高级）。

- 列表按字母序，很长；**没有搜索框**，往下滑找。与我们相关的关键字：`Pointer`、`Pen`、`Stylus`、`Touch`、`Coalesced`、`Twist`。不同 iPadOS 小版本里条目名字会变、也可能根本没有对应项（例如 altitude/azimuth 在 18.2 起已是默认开启，不需要标志）。
- 做法：先**截一张功能标志列表的图**（或把含上述关键字的条目名和开关状态抄下来）附在探针 JSON 旁，这样后面能对上「哪次测试是在什么开关下做的」。
- 只改看得懂的项，改一项就重跑一次探针对比；改完后**彻底关掉 Safari（上滑关闭）再打开**才生效。改动过的项要记在 `exports/` 里对应 JSON 的文件名或备注里。
- 不要为了拿 twist 去开一堆实验开关：Pencil Pro 筒身旋转在 Safari 里目前没有稳定的 Web 通路，探针里「twist 非零」为 0 是预期结果。

## 5. 添加到主屏幕（全屏，去掉地址栏）

Safari → 分享按钮 → **添加到主屏幕**。`probe.html` 与主页都已声明 `apple-mobile-web-app-capable`，从主屏幕图标打开会以全屏 standalone 模式运行：

- 没有地址栏，书写区更大，也不会因为误触地址栏丢笔；
- **没有刷新按钮**：改了 Mac 上的代码后，要从 App 切换器上滑关掉再重开；
- standalone 与 Safari 标签是两个独立的存储/会话（localStorage 不共享）；
- 探针页的「全屏 standalone」一行会显示「是」。

## 6. 把导出的 JSON 拿回来

- **方式一（局域网 server.js）**：探针「导出结果」和工作台「导出手写样本」通过 `POST save-json`（评估工具的出图通过 `POST save-png`）直接写进 Mac 项目的 **`exports/`** 目录（已在 `.gitignore`）：

  ```bash
  ls -t exports/probe-*.json | head        # 最近的探针结果
  cat "$(ls -t exports/probe-*.json | head -1)" | head -60
  ```

- `/save-json?name=<prefix>` 的 `name` 只允许 `[a-z0-9-]`，默认 `data`；正文上限 5MB，超过返回 413。
- **方式二（GitHub Pages）**：没有 `exports/` 目录——导出走系统共享（AirDrop 到 Mac / 存到「文件」）或浏览器下载，见第 1b 节；文件名同构，拷进 Mac 的 `exports/` 即可。
- 两种方式都失败（页面红字）时，探针页下方「查看 / 手动复制 JSON」可展开文本框，长按全选复制，通过通用剪贴板（Mac 与 iPad 同一 Apple ID + 蓝牙/Wi-Fi 开着）直接在 Mac 上粘贴。

## 7. 排错速查

| 现象 | 查什么 |
|---|---|
| iPad 打不开 URL（方式一） | Mac 是否用了 `--lan`；两台是否同一 Wi-Fi 网段；Mac 防火墙；VPN；`lsof -nP -iTCP:8642 -sTCP:LISTEN` 应显示 `*:8642` 而不是 `127.0.0.1:8642` |
| 页面能开，导出 413 | JSON 超 5MB——先「清零」再采样（样本池已有上限，正常不会到） |
| 方式一下点导出，文件却被"下载"而没进 `exports/` | 预览进程还是旧版 `server.js`（POST save-json → 404，与静态站无法区分，于是走了下载）：重启 `node server.js` 即可。桌面浏览器开 Pages 时这是正常路径 |
| `pointermove/秒` 远低于 60 | 低电量模式；Safari 后台标签太多；页面被缩放（探针「视口」一行 scale≠1） |
| 合并样本数 ≈1 | Safari < 18.2，或事件来自合成派发；看「特性探测」一栏 `getCoalescedEvents` 是否为「是」 |
| altitude/azimuth 显示「否」 | iPadOS < 18.2：走 Touch Events 私有字段回退（探针「Touch Events 私有扩展」一栏） |
| 写字时手掌触发滚动/缩放 | 书写区是 `touch-action:none`，滚动只会发生在书写区外；用主屏幕全屏模式并关多任务手势 |
| 从角落起笔就截屏 | 第 3 节「从角落划动」没关 |
