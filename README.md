# FlowTrail Console

A React + TypeScript console for observing, replaying and recovering durable workflow runs.

**Follow node attempts and execution events through a real Java process crash, reconnect without duplicate events, and compare a virtual event list against the same 10,000-row baseline.**

English | [中文](README_ZH.md) · [Architecture](docs/architecture.md) · [Recovery demo](docs/recovery.md) · [Measured performance](docs/performance.md)

![Real FlowTrail run monitor with synthetic demo data](docs/images/console-desktop.png)

## What you can try

- Create a TEXT, mock LLM or recovery workflow, submit inputs and inspect the latest 50 runs per workflow.
- Read node outputs, errors and individual attempts alongside a searchable event timeline.
- Stop and resume observation, disconnect the browser, or restart the Java process and replay persisted events.
- Resume eligible failed runs after the lease expires. Successful checkpoints are preserved; interrupted attempts remain visible.
- Open `/performance` to compare ordinary and virtual lists using the same deterministic synthetic events.

This is a portfolio project built on [FlowTrail Server](https://github.com/cloudwallker/flowtrail-server). The existing execution engine is reused; this repository adds the React console, event client, stable snapshot contract, browser acceptance suite and evidence. See [source attribution](docs/provenance.md).

## Run locally

Requires Node.js **24.15+** (the 22.x line requires 22.22.2+), Java **21**, Maven **3.8.5+** and free ports 5173, 18081 and 18082. Maven and npm must be on `PATH`; set `JAVA_HOME` to Java 21.

```sh
npm ci --legacy-peer-deps
npm run dev
```

Open **http://127.0.0.1:5173/workflows**. The launcher builds the backend, starts its file-backed H2 database and a local HTTP demo service, and starts Vite with an API proxy. Choose “创建工作流” to create a demo. TEXT and mock LLM examples need no external account or API key. The development data persists under `server/data/` and is ignored by Git. Stop the launcher with Ctrl+C.

For an existing FlowTrail backend, use `npm run dev:ui`; set `FLOWTRAIL_API_URL` to its origin before starting Vite (default `http://127.0.0.1:18081`). It must expose the `lastEventSeq`/`createdAt` contract described in [architecture](docs/architecture.md).

## Build one runnable JAR

```sh
npm run build:all
java -jar server/target/flowtrail-server.jar
```

Open **http://127.0.0.1:18081/workflows**. Frontend production assets are included in the JAR; supported React deep links are forwarded to its index, while `/api` retains JSON responses. TEXT and mock LLM work on their own. To run the HTTP recovery template, also start `node scripts/demo-service.mjs` on port 18082.

The API is intended for a trusted local environment. Authentication, multi-tenancy, deployment hardening, backend execution cancellation and external-write approval UI are outside this version. “停止监听” stops browser observation only. `MANUAL_REVIEW` requires checking external side effects; resume never grants an override of that decision.

## Verify and reproduce evidence

```sh
npm run typecheck
npm test
npm run build:all
npx playwright install chromium
npm run test:e2e
npm run benchmark
```

Playwright starts its own isolated H2-backed Java process and local demo/controller services on 18081–18083, plus Vite on 4173. Those ports must be free. The test controller belongs only to the local harness; it is not part of the production API. Browser tests exercise real API calls, double clicks and idempotency, request races, replay gaps, offline catch-up, more than 1,000 durable events, a forcibly killed Java process, recovery and checkpoint reuse. Network corruption tests explicitly use browser fault injection. CI runs the same checks with an additional MySQL 8.4 service and retains browser artifacts.

The committed [performance report](docs/performance.md) contains five alternating production samples per mode, environment details and raw JSON. It measures synthetic data, not production throughput. [Recovery instructions](docs/recovery.md) explain how the video and structured evidence are generated; [verification evidence](docs/verification.md) records the executed checks and scope.

## Layout and design

| Path | Responsibility |
|---|---|
| `src/pages`, `src/components` | Routes, forms, run monitor and virtual timeline |
| `src/queries.ts`, `src/form.ts` | REST state, monotonic snapshot merge and submission identity |
| `src/events` | Contiguous cursor, replay, attempt projection and connection lifecycle |
| `server` | Reused Spring Boot engine plus stable monitoring snapshots and SPA entry |
| `e2e`, `scripts` | Real service harness, fault injection, recovery evidence and benchmarks |
| `docs` | Architecture, measured results, demo evidence and attribution |

The URL holds filters; TanStack Query holds REST snapshots; React Hook Form + Zod holds inputs; the event client owns replay projection; component state holds dialogs. `(runId, seq)` deduplicates events. The cursor advances only after a validated, contiguous event is projected. A terminal REST snapshot ends observation only when its watermark has been consumed. Details and trade-offs are in [architecture](docs/architecture.md).

## License

MIT. Backend attribution and original license are retained under `server/`; dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
