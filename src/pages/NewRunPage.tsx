import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { Workflow } from '../lib/types';
import { buildInputs, requiredInputs, SubmissionIdentity } from '../form';
import { keys, mergeRunSnapshot, useWorkflow } from '../queries';
import { ErrorState, errorMessage, LoadingState } from '../components/LoadState';
const schema = z.object({ entries: z.array(z.object({ key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]*$/, '使用以字母开头的字母、数字或下划线'), value: z.string() })).max(50, '最多支持 50 个输入字段').superRefine((entries, context) => { const seen = new Set<string>(); entries.forEach((entry, index) => { if (seen.has(entry.key)) context.addIssue({ code: 'custom', path: [index, 'key'], message: '输入名称重复' }); seen.add(entry.key); }); }) });
type Values = z.infer<typeof schema>;
export default function NewRunPage() {
  const { id = '' } = useParams();
  const query = useWorkflow(id);
  if (query.isPending) return <LoadingState />;
  if (query.isError && !query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <LoadingState />;
  return <>{query.isError && <div className="notice warning" role="alert"><strong>工作流信息刷新失败</strong><span>已保留当前输入和请求键：{errorMessage(query.error)}</span><button className="button secondary small" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? '正在重新加载…' : '重新加载'}</button></div>}<RunForm key={id} workflow={query.data} /></>;
}
function RunForm({ workflow }: { workflow: Workflow }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const identity = useRef(new SubmissionIdentity());
  const mounted = useRef(true);
  const submitting = useRef(false);
  const submissionController = useRef<AbortController | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const required = requiredInputs(workflow);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { entries: required.map((key) => ({ key, value: key === 'document' ? '这是一份用于观察工作流执行的示例文档。' : '' })) } });
  const fields = useFieldArray({ control: form.control, name: 'entries' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; submissionController.current?.abort(); }; }, []);
  const create = useMutation({ mutationFn: ({ inputs, key, signal }: { inputs: Record<string, string>; key: string; signal: AbortSignal }) => api.createRun(workflow.id, inputs, key, signal), onSuccess: (run) => { client.setQueryData(keys.run(run.id), (previous: typeof run | undefined) => mergeRunSnapshot(previous, run)); void client.invalidateQueries({ queryKey: keys.runs(workflow.id) }); if (mounted.current) navigate(`/runs/${run.id}`); }, onSettled: () => { submitting.current = false; submissionController.current = null; } });
  const submit = form.handleSubmit((values) => {
    if (submitting.current || !mounted.current) return;
    try {
      const inputs = buildInputs(values.entries);
      const missing = required.filter((key) => !Object.hasOwn(inputs, key));
      if (missing.length) throw new Error(`缺少流程引用的输入：${missing.join('、')}`);
      const key = identity.current.forInputs(inputs);
      setRequestKey(key); setLocalError(null);
      submitting.current = true;
      const controller = new AbortController();
      submissionController.current = controller;
      create.mutate({ inputs, key, signal: controller.signal });
    } catch (error) { setLocalError(errorMessage(error)); }
  });
  return <><Link className="back-link" to={`/workflows/${workflow.id}/runs`}><ArrowLeft size={15} />返回运行历史</Link><div className="page-heading"><div><div className="eyebrow">NEW RUN / 新建运行</div><h1>让工作流开始执行</h1><p>{workflow.name} · {workflow.nodes.length} 个节点</p></div></div><div className="new-run-layout"><form className="panel input-panel" onSubmit={submit}><div className="panel-heading"><div><h2>输入参数</h2><p>参数值均以字符串提交。工作流引用的字段已自动添加。</p></div><span className="tag">{fields.fields.length} / 50</span></div><div className="input-rows">{fields.fields.map((field, index) => <div className="input-entry" key={field.id}><div className="input-entry-heading"><label className="field">输入名称<input {...form.register(`entries.${index}.key`)} aria-label={`输入名称 ${index + 1}`} disabled={create.isPending} placeholder="document" aria-invalid={!!form.formState.errors.entries?.[index]?.key} /></label><button className="icon-button danger-text" type="button" aria-label={`删除输入 ${index + 1}`} disabled={create.isPending} onClick={() => fields.remove(index)}><Trash2 size={17} /></button></div>{form.formState.errors.entries?.[index]?.key && <p className="field-error">{form.formState.errors.entries[index]?.key?.message}</p>}<label className="field">字符串值<textarea {...form.register(`entries.${index}.value`)} aria-label={`输入值 ${index + 1}`} disabled={create.isPending} rows={4} placeholder="填写运行输入内容" /></label></div>)}{!fields.fields.length && <p className="muted">当前没有输入参数。可直接运行无需输入的工作流，或添加参数。</p>}</div><button className="button ghost add-input" type="button" disabled={create.isPending || fields.fields.length >= 50} onClick={() => fields.append({ key: '', value: '' })}><Plus size={16} />添加输入字段</button>
    {localError && <div className="notice error" role="alert">{localError}</div>}{create.isError && <div className="notice error" role="alert"><strong>提交未能确认</strong><span>{errorMessage(create.error)}</span><small>保持输入不变再提交，将复用同一请求键。修改输入后提交，将使用新键创建新的运行请求。</small></div>}{requestKey && <div className="request-key"><KeyRound size={14} /><span>本次请求键</span><code>{requestKey}</code></div>}
    <div className="form-actions"><Link className="button secondary" to={`/workflows/${workflow.id}/runs`}>返回</Link><button type="submit" className="button primary" disabled={create.isPending}>{create.isPending ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{create.isPending ? '正在提交…' : create.isError ? '重新提交运行' : '启动运行'}</button></div></form><aside className="run-guide"><div className="eyebrow">EXECUTION PLAN / 执行计划</div><h2>本次运行的节点</h2><ol>{workflow.nodes.map((node, index) => <li key={node.id}><span>{index + 1}</span><div><strong>{node.id}</strong><small>{node.type} · {node.dependsOn?.length ? `依赖 ${node.dependsOn.join('、')}` : '起始节点'}</small></div></li>)}</ol><div className="notice neutral">提交成功后进入监控台。关闭页面或停止监听不会取消后端执行。</div></aside></div></>;
}
