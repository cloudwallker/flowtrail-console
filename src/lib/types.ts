export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'MANUAL_REVIEW';
export type NodeStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'MANUAL_REVIEW';
export interface NodeDefinition {
  id: string; type: 'TEXT' | 'HTTP' | 'LLM'; dependsOn?: string[];
  text?: string; url?: string; method?: 'GET' | 'POST'; body?: string;
  headers?: Record<string, string>; modelRef?: string; systemPrompt?: string; userPrompt?: string;
  timeoutMs?: number; idempotency?: { supported: boolean; lookupUrl?: string };
}
export interface Workflow { id: string; name: string; nodes: NodeDefinition[]; createdAt: string }
export interface WorkflowRequest { name: string; nodes: NodeDefinition[] }
export interface NodeAttempt { attemptId: number; status: string; output: string | null; error: string | null; startedAt: string; finishedAt: string | null }
export interface NodeResult { id: string; status: NodeStatus; output: string | null; error: string | null; durationMs: number; attemptId: number; attempts: NodeAttempt[] }
export interface Run { id: string; workflowId: string; status: RunStatus; inputs: Record<string, string>; nodes: NodeResult[]; startedAt: string; finishedAt: string | null; lastEventSeq: number }
export interface RunEvent { runId: string; nodeId: string | null; attemptId: number | null; seq: number; type: string; payload: Record<string, unknown>; createdAt: string }
export const isTerminal = (status: RunStatus) => ['SUCCEEDED', 'FAILED', 'MANUAL_REVIEW'].includes(status);
