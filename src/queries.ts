import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import type { Run } from './lib/types';
export function mergeRunSnapshot(previous: Run | undefined, next: Run): Run {
  if (previous?.id === next.id && previous.lastEventSeq > next.lastEventSeq) return previous;
  return next;
}
export const keys = {
  workflows: ['workflows'] as const,
  workflow: (id: string) => ['workflow', id] as const,
  runs: (id: string) => ['runs', id] as const,
  run: (id: string) => ['run', id] as const,
};
export function useWorkflows() {
  return useQuery({ queryKey: keys.workflows, queryFn: ({ signal }) => api.listWorkflows(signal) });
}
export function useWorkflow(id: string) {
  return useQuery({ queryKey: keys.workflow(id), queryFn: ({ signal }) => api.getWorkflow(id, signal), enabled: !!id });
}
export function useRuns(id: string) {
  return useQuery({ queryKey: keys.runs(id), queryFn: ({ signal }) => api.listRuns(id, signal), enabled: !!id, refetchInterval: 5000 });
}
export function useRun(id: string) {
  return useQuery({ queryKey: keys.run(id), queryFn: ({ signal }) => api.getRun(id, signal), enabled: !!id, refetchInterval: 2000,
    structuralSharing: (previous, next) => mergeRunSnapshot(previous as Run | undefined, next as Run) });
}
