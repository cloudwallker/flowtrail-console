# 来源与改动 / Provenance

后端复用 MIT 许可的 [cloudwallker/flowtrail-server](https://github.com/cloudwallker/flowtrail-server)，源版本 `328cd96b947486840ae963a01580eb4533abd3f1`。保留 `server/LICENSE`、`server/THIRD_PARTY_NOTICES.md` 和原执行引擎源码，不将原引擎宣称为本次新作。

本仓库的主要新增内容：React＋TypeScript 路由与组件、状态/表单管理、事件一致性客户端、虚拟列表、生产资源集成、Playwright 故障验收、持续集成和实测文档。后端改动集中在监控 DTO 的水位/时间字段、稳定读取事务与 SPA 页面入口；原持久化、租约、检查点和外部写保护能力来自 FlowTrail Server。

界面截图、恢复录像使用合成输入和本地 HTTP 服务。性能数据使用确定性的合成事件；演示强杀的是隔离测试 Java 进程。没有把模拟 LLM 或合成负载称为真实供应商请求或生产流量。

The Java backend is derived from the MIT-licensed repository and exact revision above. Original license notices and execution-engine source are retained. New work is the React console, monitoring contract, replay client, integration harness and evidence. Images and recovery recordings use synthetic inputs and a local HTTP service; benchmark events are deterministic synthetic data.
