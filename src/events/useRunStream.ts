import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import type { Run } from '../lib/types';
import { RunEventClient } from './client';
import type { EventConnection } from './client';

export function useRunStream(runId: string, run?: Run) {
  const client = useMemo(() => new RunEventClient(runId, {
    history: api.history,
    run: api.getRun,
    source: url => new EventSource(url) as unknown as EventConnection,
  }), [runId]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => { void client.start(); return () => client.stop(); }, [client]);
  useEffect(() => { if (run) client.setRun(run); }, [client, run]);
  return { ...state, start: () => { void client.start(); }, stop: () => client.stop() };
}
