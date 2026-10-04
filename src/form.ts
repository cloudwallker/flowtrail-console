import type { WorkflowRequest } from './lib/types';
export interface InputEntry { key: string; value: string }
export function buildInputs(entries: InputEntry[]): Record<string, string> {
  if (entries.length > 50) throw new Error('最多支持 50 个输入字段');
  const seen = new Set<string>();
  const values = entries.map(({ key, value }) => {
    const cleanKey = key.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(cleanKey)) throw new Error('输入名称需以字母开头，仅包含字母、数字或下划线');
    if (seen.has(cleanKey)) throw new Error(`输入名称重复：${cleanKey}`);
    seen.add(cleanKey);
    return [cleanKey, value] as const;
  });
  return Object.fromEntries(values);
}
export function requiredInputs(workflow: WorkflowRequest): string[] {
  return [...new Set([...JSON.stringify(workflow.nodes).matchAll(/\$\{input\.([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))];
}
export class SubmissionIdentity {
  private signature: string | null = null;
  private key: string | null = null;
  constructor(private readonly createKey: () => string = () => crypto.randomUUID()) {}
  forInputs(inputs: Record<string, string>): string {
    const signature = JSON.stringify(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
    if (this.signature !== signature || !this.key) {
      this.signature = signature;
      this.key = this.createKey();
    }
    return this.key;
  }
  reset(): void { this.signature = null; this.key = null; }
}
