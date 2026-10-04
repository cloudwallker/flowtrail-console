// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import PerformancePage from './PerformancePage';

vi.mock('../components/EventList', () => ({ EventList: () => <div data-event-row="true" /> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__flowtrailBenchmark = undefined; });

it('measures a new render when browser navigation changes the list mode', () => {
  let clock = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextId; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = () => act(() => {
    for (let frame = 0; frame < 2; frame++) {
      const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(clock));
    }
  });
  function Back() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>浏览器返回</button>; }
  render(<MemoryRouter initialEntries={['/performance?mode=virtual&count=1000']}><PerformancePage /><Back /></MemoryRouter>);
  clock = 25; flush();
  expect(window.__flowtrailBenchmark?.renderMs).toBe(25);
  clock = 100; fireEvent.click(screen.getByRole('button', { name: '普通列表' }));
  clock = 125; flush();
  clock = 2300; fireEvent.click(screen.getByRole('button', { name: '浏览器返回' }));
  clock = 2325; flush();
  expect(window.__flowtrailBenchmark?.mode).toBe('virtual');
  expect(window.__flowtrailBenchmark?.renderMs).toBe(25);
});
