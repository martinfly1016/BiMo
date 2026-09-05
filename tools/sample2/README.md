# sample2.mp4（行书「小寒」）勘察产物 · 2026-09-05

来源：项目回顾工作流的视频勘察代理（见 docs/project-review-2026-09-05.md §1.1 与勘察 B）。
脚本用 Python（numpy/OpenCV），输入为 ffmpeg 从 sample2.mp4 抽出的帧；帧本身未入库（可按脚本内的时间戳重抽）。
以下描述按脚本内容与勘察记录整理，使用前请先读脚本头部。

## 脚本
- arrival.py —— 逐帧墨像素「到达时间图」（每个像素首次持久变黑的时刻），输出 arrival_t.npy / arrival_map.png；用于切笔画与估速度节奏。
- homog.py / homog2.py —— 书写镜头（斜视，38.5s 无手帧）→ 成品静帧（42.17s 俯视照片）的单应配准：连通域质心种子 + 轮廓 ICP；输出 H_obl_to_still.npy（IoU 0.74，轮廓中位距离 0.8px）。
- crops.py / crops2.py —— 关键帧局部裁切放大（obl*_*.png：反捺飞白、钩、小、寒等）。
- head_analysis.py —— 起笔头部形态分析。
- inkstats.py —— 静帧墨掩膜与宽度统计（距离变换：中位 6px、p95 14px、最粗 18px）。
- sheets.py —— 抽帧联络表（sheet_*.png，未入库）。
- stab.py / stab2.py —— 镜头稳定性（相位相关跟踪左上木条：35s 内漂移 ≤1.4px）。
- sealcheck.py —— 成品静帧上朱文印「青」的位置/颜色检查（做掩膜时需屏蔽）。

## 数据与图
- H_obl_to_still.npy —— 3×3 单应矩阵（斜视帧 → 静帧）。
- arrival_t.npy —— 到达时间图（float，秒；斜视帧坐标 480×854）。
- still_ref_42.17.png —— 成品静帧（另拍俯视照片，含红印，色温/尺度/方向与书写镜头不同）。
- still_inkmask_g110.png —— 静帧黑墨掩膜（gray<110 判据初版）。
- final_mask_oblique.png —— 38.5s 无手帧墨掩膜。
- overlay_obl_vs_still.png / obl385_warped_to_still.png —— 配准叠合与反投影检查图。
- obl350_na.png（反捺飞白丝状分丛）、obl385_han.png、obl385_xiao.png、tail_039.5s.png —— 关键局部。

## 关键事实（摘要）
- 「小寒」二字，行书偏行草，黑墨（成品帧偏蓝黑 RGB≈(14,33,37)），无格线无纸边，自来水毛笔（笔身与墨同色）。
- 飞白只出现在「快+重压」处（反捺腹部、钩内侧），供墨稳定无逐字变枯 → 成因是毫束分丛而非墨少。
- 总书写≈33s，其中≈10s 悬笔停顿；宀横钩同笔 2→14px 极端提按；龷中横 0.5s 内 660px 为最快笔。
- 参照只能靠字迹自配准（无四角可标定），成品帧是异机位照片且分辩不出飞白，飞白评估需用斜视帧经 H 反投影。
