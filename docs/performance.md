# 性能对照 / Performance comparison

测量时间：2026-10-04T16:15:12.713Z。固定10,000条合成事件，同一EventRow、1440×1000视口，每种模式5次交替运行。每次使用新的浏览器上下文。构建来源：Vite production build。

环境：win32 10.0.26200 x64；12th Gen Intel(R) Core(TM) i7-12700H；Node v24.15.0；Chromium 153.0.8010.12（headless）。

| 模式 | 挂载事件行中位数 | 挂载耗时中位数 | 挂载耗时范围 | 滚动帧间隔p95中位数 | 滚动长任务中位数 |
|---|---:|---:|---:|---:|---:|
| plain | 10000 | 1477.4 ms | 1343.6–2152.3 ms | 33.4 ms | 1 |
| virtual | 16 | 291.3 ms | 276.8–299 ms | 16.7 ms | 0 |

复现：`npm ci --legacy-peer-deps`、`npx playwright install chromium`、`npm run benchmark`。原始结果：[benchmark-results.json](benchmark-results.json)。

默认脚本自动构建生产资源；设置 FLOWTRAIL_BENCHMARK_URL 时使用外部页面，脚本不确认其构建来源。

挂载耗时从性能页面开始渲染，到连续两帧后的已挂载列表测量；不包含导航前的网络和脚本加载。滚动以120个动画帧从首部到尾部，记录帧间隔与主线程≥50ms长任务。测量的是合成负载，不能外推为生产流量或所有设备表现；虚拟化降低DOM数量，不等于降低全部数据的内存占用。

The comparison uses the same deterministic 10,000 events and shared row component. Build source: Vite production build. Modes alternate across at least five fresh browser contexts each. Mount timing excludes navigation/network before component render; the scroll script traverses the list over 120 animation frames. Raw samples and environment are recorded above. These synthetic, headless measurements are reproducible evidence, not a production throughput claim.
