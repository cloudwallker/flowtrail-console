import type { Run, RunEvent } from '../lib/types';
import { isTerminal } from '../lib/types';
import { ApiError } from '../lib/api';
import { acceptEvent, createEventState, EventGapError, EventProtocolError } from './state';
import type { EventState } from './state';
export interface EventConnection { onopen: (() => void) | null; onerror: (() => void) | null; addEventListener(name: string, listener: (message: {data: string}) => void): void; close(): void }
export interface StreamSnapshot extends EventState { connection: 'connecting' | 'live' | 'reconnecting' | 'catching-up' | 'paused' | 'complete' | 'error'; error: string | null; retryInMs: number }
export interface ClientDependencies { history(runId: string, after: number, signal?: AbortSignal): Promise<RunEvent[]>; run(runId: string, signal?: AbortSignal): Promise<Run>; source(url: string): EventConnection; random?: () => number }
export class RunEventClient {
  private state: StreamSnapshot;
  private listeners = new Set<() => void>();
  private source: EventConnection | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private running = false;
  private retries = 0;
  private latestRun: Run | undefined;
  constructor(private runId: string, private dependencies: ClientDependencies) {
    this.state = { ...createEventState(runId), connection: 'paused', error: null, retryInMs: 0 };
  }
  getSnapshot = (): StreamSnapshot => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<StreamSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private closeSource() { this.source?.close(); this.source = null; }
  private cleanup() {
    this.closeSource(); this.controller?.abort(); this.controller = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private current(generation: number) { return this.running && generation === this.generation; }
  setRun(run: Run) {
    if (run.id !== this.runId) return;
    if (!this.latestRun || run.lastEventSeq >= this.latestRun.lastEventSeq) this.latestRun = run;
    if (this.running) this.finishIfCaughtUp();
  }
  private finishIfCaughtUp() {
    if (!this.latestRun || !isTerminal(this.latestRun.status) || this.state.cursor < this.latestRun.lastEventSeq) return false;
    this.running = false; this.generation++; this.cleanup();
    this.update({ connection: 'complete', retryInMs: 0, error: null });
    return true;
  }
  async start(): Promise<void> {
    this.cleanup(); this.generation++; this.running = true; this.retries = 0;
    this.controller = new AbortController();
    this.update({ connection: 'connecting', error: null, retryInMs: 0 });
    await this.synchronize(this.generation);
  }
  stop() {
    this.running = false; this.generation++; this.cleanup();
    this.update({ connection: 'paused', retryInMs: 0, error: null });
  }
  private fatal(message: string) {
    this.running = false; this.generation++; this.cleanup();
    this.update({ connection: 'error', error: message, retryInMs: 0 });
  }
  private retry(generation: number, message: string | null = null) {
    if (!this.current(generation) || this.timer !== null) return;
    this.closeSource();
    const delay = Math.min(30000, Math.round(1000 * 2 ** Math.min(this.retries++, 5) * (0.8 + (this.dependencies.random || Math.random)() * 0.4)));
    this.update({ connection: 'reconnecting', error: message, retryInMs: delay });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.current(generation)) void this.synchronize(generation);
    }, delay);
  }
  private async synchronize(generation: number) {
    if (!this.current(generation)) return;
    this.closeSource();
    this.update({ connection: 'catching-up', retryInMs: 0 });
    try {
      while (this.current(generation)) {
        const before = this.state.cursor;
        const page = await this.dependencies.history(this.runId, before, this.controller?.signal);
        if (!this.current(generation)) return;
        let projected: EventState = this.state;
        for (const event of page) projected = acceptEvent(projected, event);
        this.update({ cursor: projected.cursor, events: projected.events, attempts: projected.attempts });
        if (page.length < 1000) break;
        if (projected.cursor <= before) throw new EventGapError(before + 1, before);
      }
      const run = await this.dependencies.run(this.runId, this.controller?.signal);
      if (!this.current(generation)) return;
      this.setRun(run);
      if (!this.current(generation) || this.finishIfCaughtUp()) return;
      this.update({ connection: 'connecting', retryInMs: 0 });
      const source = this.dependencies.source(`/api/runs/${encodeURIComponent(this.runId)}/events?after=${this.state.cursor}`);
      this.source = source;
      const isCurrentSource = () => this.current(generation) && this.source === source;
      source.onopen = () => { if (isCurrentSource()) { this.retries = 0; this.update({ connection: 'live', retryInMs: 0, error: null }); } };
      source.addEventListener('workflow', message => {
        if (!isCurrentSource()) return;
        try {
          const projected = acceptEvent(this.state, JSON.parse(message.data));
          if (projected === this.state) return;
          this.update({ cursor: projected.cursor, events: projected.events, attempts: projected.attempts });
          this.finishIfCaughtUp();
        } catch (error) {
          this.closeSource();
          if (error instanceof EventGapError) void this.synchronize(generation);
          else this.fatal('事件数据无效，已保留最后连续游标。请重新同步或检查服务协议。');
        }
      });
      source.onerror = () => {
        if (!isCurrentSource()) return;
        // Disable the browser's autonomous retry before scheduling our single reconnect path.
        this.closeSource();
        if (!this.finishIfCaughtUp()) this.retry(generation);
      };
    } catch (error) {
      if (!this.current(generation)) return;
      if (error instanceof EventGapError || error instanceof EventProtocolError || error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) {
        this.fatal('历史事件不连续或格式无效，无法确认已完整补齐。最后有效游标已保留。');
      } else if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        this.fatal(error.message);
      } else this.retry(generation, '暂时无法连接服务，正在从最后连续游标重试');
    }
  }
}
