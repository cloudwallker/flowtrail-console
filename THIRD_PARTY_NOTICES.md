# Third-party notices / 第三方说明

FlowTrail Console is MIT-licensed. Its reused backend is derived from [FlowTrail Server](https://github.com/cloudwallker/flowtrail-server), with original notices retained in [server/LICENSE](server/LICENSE) and [server/THIRD_PARTY_NOTICES.md](server/THIRD_PARTY_NOTICES.md).

The console uses React, React Router, TanStack Query, TanStack Virtual, React Hook Form, Zod and Lucide. Build and validation tools include Vite, TypeScript, Vitest, Testing Library, Playwright, jsdom and marked. These packages remain subject to their own licenses distributed with the installed packages; pinned resolved versions and dependency provenance are recorded in `package-lock.json`. Lucide icons are subject to its ISC license and Lucide/Feather notices shipped with the package.

Complete license and copyright texts for locked frontend runtime packages and production build helpers are retained in [docs/frontend-licenses.txt](docs/frontend-licenses.txt). Every `npm run build` regenerates this inventory from the installed, lock-matched packages and includes the same text as `dist/third-party-licenses.txt`; the runnable JAR serves it at `/third-party-licenses.txt`.

The Java runtime dependencies and licenses are listed separately in the retained backend notices and Maven POM. Generated dependencies, browser binaries and runnable JARs are not committed to this source repository.

本项目保留原后端许可及署名。前端与测试依赖以各自随包分发的许可证为准，精确版本由锁文件记录；Lucide 图标的 ISC 与相关原始署名亦随依赖保留。前端运行时依赖及生产构建辅助代码的完整许可文本见上述清单，每次构建会同时写入生产资源并打包到 JAR。源码仓库不包含安装依赖、浏览器二进制或构建 JAR。
