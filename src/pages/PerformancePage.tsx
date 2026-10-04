import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, FlaskConical, Layers3 } from 'lucide-react';
import { EventList } from '../components/EventList';
import { benchmarkEvents } from '../lib/benchmark-data';

interface Measurement { renderMs: number; rowCount: number; count: number; mode: 'plain' | 'virtual' }
declare global { interface Window { __flowtrailBenchmark?: Measurement & { ready: boolean } } }

export default function PerformancePage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'plain' ? 'plain' : 'virtual';
  const count = params.get('count') === '1000' ? 1000 : 10000;
  const started = useMemo(() => performance.now(), [count, mode]);
  const events = useMemo(() => benchmarkEvents(count), [count]);
  const [measurement, setMeasurement] = useState<Measurement>();
  useEffect(() => {
    window.__flowtrailBenchmark = undefined;
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        const value: Measurement = { renderMs: Math.round((performance.now() - started) * 100) / 100, rowCount: document.querySelectorAll('[data-event-row]').length, count, mode };
        window.__flowtrailBenchmark = { ...value, ready: true };
        setMeasurement(value);
      });
    });
    return () => { cancelAnimationFrame(frame1); cancelAnimationFrame(frame2); };
  }, [count, mode, started]);
  const update = (key: string, value: string) => {
    setParams(previous => { const next = new URLSearchParams(previous); next.set(key, value); return next; });
  };
  const current = measurement?.mode === mode && measurement.count === count ? measurement : undefined;
  return <>
    <div className="page-heading"><div><div className="eyebrow">PERFORMANCE LAB / 性能实验</div><h1>让数据量增长，保持页面轻盈</h1><p>同一份固定事件、同一种行组件，比较普通列表和虚拟列表。</p></div><span className="tag"><FlaskConical size={15} />合成测试数据</span></div>
    <div className="summary-strip"><div><Layers3 size={21} /><span>事件总数</span><strong>{count.toLocaleString()}</strong></div><div><Activity size={21} /><span>挂载事件行</span><strong data-testid="mounted-rows">{current?.rowCount ?? '测量中'}</strong></div><div><span>本次页面挂载</span><strong>{current ? `${current.renderMs} ms` : '测量中'}</strong></div></div>
    <div className="section-bar"><h2>事件列表对照</h2><div className="filters"><select aria-label="测试事件数量" value={count} onChange={event => update('count', event.target.value)}><option value="1000">1,000 条事件</option><option value="10000">10,000 条事件</option></select><button className={`button ${mode === 'plain' ? 'primary' : 'secondary'}`} aria-pressed={mode === 'plain'} onClick={() => update('mode', 'plain')}>普通列表</button><button className={`button ${mode === 'virtual' ? 'primary' : 'secondary'}`} aria-pressed={mode === 'virtual'} onClick={() => update('mode', 'virtual')}>虚拟列表</button></div></div>
    <div className="notice">当前为{mode === 'virtual' ? '虚拟列表：仅挂载视口及缓冲区中的事件行' : '普通列表：挂载全部事件行'}。测试数据具有稳定序号与时间，代表合成负载。</div>
    <div className="panel"><EventList events={events} mode={mode} /></div>
    <p className="muted" style={{ marginTop: 20, lineHeight: 1.8 }}>本页显示当前浏览器的一次测量，不能代替完整性能报告。使用 <code>npm run benchmark</code> 对生产构建交替运行至少 5 次，记录环境、挂载行数、渲染耗时、滚动长任务和波动。虚拟化减少 DOM，不会消除历史数据本身的内存占用。</p>
  </>;
}
