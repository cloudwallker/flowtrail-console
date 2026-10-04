import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RunEvent } from '../lib/types';
import { EventRow } from './EventRow';
export function EventList({ events, mode = 'virtual' }: { events: RunEvent[]; mode?: 'plain' | 'virtual' }) {
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: mode === 'virtual' ? events.length : 0, getScrollElement: () => parent.current, estimateSize: () => 48, overscan: 8, getItemKey: (index) => `${events[index].runId}:${events[index].seq}` });
  return <div className="event-scroll" ref={parent} tabIndex={0} role="region" aria-label="执行事件时间线" data-event-list={mode}>
    {events.length === 0 ? <div className="event-empty">尚无符合条件的事件</div> : mode === 'plain' ? events.map((event) => <EventRow key={`${event.runId}:${event.seq}`} event={event} />) : <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>{virtual.getVirtualItems().map((item) => <div key={item.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: item.size, transform: `translateY(${item.start}px)` }}><EventRow event={events[item.index]} /></div>)}</div>}
  </div>;
}
export default EventList;
