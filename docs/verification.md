# 验收记录 / Verification evidence

以下记录来自本地实际运行；云端持续集成结果以仓库 Actions 页面中对应提交为准。

| 验证 | 实际结果 | 覆盖范围 |
|---|---|---|
| `npm run typecheck` | 通过 | TypeScript strict 类型检查 |
| `npm test` | 14 个文件、48 项通过 | 状态归并、分页/缺口/重复、旧连接回调、StrictMode、幂等键、后台刷新保留表单、请求清理、键盘标签 |
| Maven 全套（启用 MySQL） | 70 项，0 失败/错误/跳过 | 2026-10-04 的执行引擎、持久化/租约/外部写保护、监控契约、MySQL 8.4 真实事务及 HTTP SSE 握手 |
| 独立发布目录 `npm run build:all` | 71 项，0 失败/错误、5 项跳过；JAR 构建通过 | 2026-10-05 的 clean verify；新增持久 H2 中断回归。本轮未配置 MySQL，5 项数据库专属用例明确跳过 |
| `npm run test:e2e` | Windows Chromium 23 项通过，0 跳过/失败/重试 | 真实 API 与用户流程、协议故障注入、断网补齐、强杀 Java/同库恢复、真实超过 1,000 条事件、JAR 深链及静态集合/许可、开发/预览代理断流 |

前端在干净发布目录的最终单元测试：2026-10-05 00:44–00:45（Asia/Shanghai）；Java 启用 MySQL 的全套：2026-10-04 23:32；新增 H2 回归及 71 项 clean verify：2026-10-05 00:46–00:47；H2 修复后的完整浏览器验收：00:38–00:41。时间记录用于标识各轮实测，不把不同轮次合并成一次全量运行，也不作为未来提交永远通过的保证。

## 如何核对

- 前端测试位于 `src/**/*.test.ts` / `*.test.tsx`；Java 测试位于 `server/src/test/java`。
- 端到端用例位于 `e2e/console.spec.ts`、`runtime.spec.ts`；恢复 JSON 附在 Playwright 报告中。
- GitHub Actions 用 Java 21、Node 24、MySQL 8.4 和 Chromium 运行同一套验证并保留 browser-acceptance artifact。Windows batch 参数测试在 Linux 按平台跳过，功能验收仍执行。
- [恢复演示](recovery.md) 包含实际视频、前后快照与连续事件；[性能报告](performance.md) 包含至少五轮同组件生产构建对照与原始样本。

MySQL 验证通过 `FLOWTRAIL_TEST_MYSQL_URL/USER/PASSWORD` 启用；没有配置本地 MySQL 时，Java 的 5 项数据库专属用例会明确跳过。CI 配置独立数据库服务，启用这些用例；不把跳过当作 MySQL 通过。

## 关键缺陷与回归

1. MySQL REPEATABLE READ 外层事务已经建立旧视图后，根行锁并不能刷新普通子查询；新增受控并发回归，子节点/attempt 也使用当前读。
2. 静默 SSE 未提交响应头，浏览器无法确认连接；新增真实 HTTP 握手回归，首帧注释不改变持久事件水位。
3. 开发代理没有关闭已提交头的损坏 SSE；代理回归与真实进程强杀验证下游能断开并补齐。
4. 后台工作流刷新失败卸载输入表单；回归证明编辑内容与未确认请求键保留。
5. 创建工作流的异步校验允许同一轮双提交；同步 guard 回归确保只创建一次，离页后不会发出尚未开始的第二阶段 POST。
6. 缓冲定时回调中断正在提交的持久 H2 写入，普通文件通道被关闭后所有 API 返回 500；按产品默认 URL 的确定性测试先复现，再验证 async 规避方案，完整浏览器回归保持真实大量事件和原并发。
7. 重复打包残留旧哈希静态资源；构建先 clean，真实 JAR 断言资源集合严格等于 dist，并校验完整前端依赖许可可读取。

各修复都先观察行为失败，再实施修复与验证。这里保留产品相关解释，执行日志、临时数据库与开发过程材料不进入公开源码。

English: The clean publication directory passed 48 frontend tests and a 71-test Java build with 5 MySQL-only skips; a previous 70-test run enabled real MySQL 8.4 with no skips. The new H2 interruption regression passed, and the final 23 Chromium tests passed without local skips or retries. These are separate runs. CI enables MySQL for the published commit; its Windows-only batch test is platform-skipped on Linux. Recovery and benchmark artifacts are linked above, and synthetic loads/fault injection are explicitly identified.
