import type { WorkflowRequest } from './types';
export const workflowTemplates: { id: string; title: string; description: string; definition: WorkflowRequest }[] = [
  { id: 'text', title: '文本处理链', description: '无需外部服务。读取输入，生成检查点，再汇总输出。', definition: { name: '文本处理链', nodes: [
    { id: 'document', type: 'TEXT', text: '${input.document}' },
    { id: 'prepared', type: 'TEXT', dependsOn: ['document'], text: '已整理文档：${document.output}' },
    { id: 'result', type: 'TEXT', dependsOn: ['prepared'], text: '处理完成\n${prepared.output}' },
  ] } },
  { id: 'llm', title: '模拟模型流式输出', description: '使用内置 mock-demo。展示流式片段，不需要模型密钥。', definition: { name: '模拟模型流式输出', nodes: [
    { id: 'document', type: 'TEXT', text: '${input.document}' },
    { id: 'summary', type: 'LLM', dependsOn: ['document'], modelRef: 'mock-demo', systemPrompt: '归纳输入文档。', userPrompt: '${document.output}' },
    { id: 'result', type: 'TEXT', dependsOn: ['summary'], text: '${summary.output}' },
  ] } },
  { id: 'recovery', title: '进程恢复演示', description: '先提交 TEXT 检查点，再访问本地慢 HTTP 服务，适合强杀进程后恢复。', definition: { name: '进程恢复演示', nodes: [
    { id: 'checkpoint', type: 'TEXT', text: '已接收：${input.document}' },
    { id: 'slow_http', type: 'HTTP', dependsOn: ['checkpoint'], method: 'GET', url: 'http://127.0.0.1:18082/slow?delay=8000', timeoutMs: 30000 },
    { id: 'result', type: 'TEXT', dependsOn: ['slow_http'], text: '${checkpoint.output}\nHTTP 结果：${slow_http.output}' },
  ] } },
];
