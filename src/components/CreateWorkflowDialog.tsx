import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, Plus, Check } from 'lucide-react';
import { api } from '../lib/api';
import { workflowTemplates } from '../lib/templates';
import { keys } from '../queries';
import { Modal } from './Modal';
import { errorMessage } from './LoadState';
const schema = z.object({ name: z.string().trim().min(1, '请输入工作流名称').max(120, '名称最多 120 个字符') });
export function CreateWorkflowDialog({ onClose }: { onClose: () => void }) {
  const submitting = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const [templateId, setTemplateId] = useState('text');
  const template = workflowTemplates.find((item) => item.id === templateId)!;
  const client = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { name: '文本处理链' } });
  const create = useMutation({ mutationFn: async ({ name }: z.infer<typeof schema>) => { const definition = { ...template.definition, name }; const signal = controller.current!.signal; await api.validateWorkflow(definition, signal); if (!mounted.current || signal.aborted) throw new DOMException('Dialog closed', 'AbortError'); return api.createWorkflow(definition, signal); }, onSuccess: async () => { await client.invalidateQueries({ queryKey: keys.workflows }); if (mounted.current) onClose(); }, onSettled: () => { submitting.current = false; } });
  const close = () => { if (!submitting.current) onClose(); };
  return <Modal title="创建工作流" onClose={close}><form onSubmit={form.handleSubmit((values) => { if (!mounted.current || submitting.current) return; submitting.current = true; controller.current = new AbortController(); create.mutate(values); })} className="modal-body form-stack">
    <p className="muted">从可运行的示例开始，使用真实后端执行。</p>
    <fieldset className="template-options" disabled={create.isPending}><legend>选择示例模板</legend>{workflowTemplates.map((item) => <label key={item.id} className={`template-option ${templateId === item.id ? 'selected' : ''}`}><input type="radio" name="template" value={item.id} checked={templateId === item.id} onChange={() => { setTemplateId(item.id); form.setValue('name', item.definition.name); create.reset(); }} /><span><strong>{item.title}</strong><small>{item.description}</small></span>{templateId === item.id && <Check size={18} />}</label>)}</fieldset>
    <label className="field">工作流名称<input {...form.register('name')} disabled={create.isPending} aria-invalid={!!form.formState.errors.name} placeholder="例如：文档处理流程" />{form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}</label>
    <div className="template-preview">{template.definition.nodes.map((node, index) => <span key={node.id}>{index > 0 && <b>→</b>}<code>{node.id}</code><small>{node.type}</small></span>)}</div>
    {templateId === 'recovery' && <div className="notice">需要启动本地演示服务（18082），开发启动脚本会同时启动它。</div>}
    {create.isError && <div className="notice error" role="alert">{errorMessage(create.error)}</div>}
    <div className="modal-actions"><button type="button" className="button secondary" disabled={create.isPending} onClick={close}>取消</button><button className="button primary" disabled={create.isPending}>{create.isPending ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{create.isPending ? '校验并创建中…' : '创建工作流'}</button></div>
  </form></Modal>;
}
