import { describe, expect, it } from 'vitest';
import { buildInputs, requiredInputs, SubmissionIdentity } from './form';

describe('运行输入与幂等身份', () => {
  it('规范输入键，保留字符串内容，并拒绝重复键', () => {
    expect(buildInputs([{ key: ' document ', value: ' 内容\n' }])).toEqual({ document: ' 内容\n' });
    expect(() => buildInputs([{ key: 'name', value: 'a' }, { key: ' name ', value: 'b' }])).toThrow();
  });
  it('拒绝空键、非法键和超过50个输入', () => {
    expect(() => buildInputs([{ key: '', value: 'a' }])).toThrow();
    expect(() => buildInputs([{ key: 'two words', value: 'a' }])).toThrow();
    expect(() => buildInputs(Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, value: 'v' })))).toThrow();
  });
  it('从所有节点配置提取并去重实际必需的输入', () => {
    expect(requiredInputs({ name: 'a', nodes: [{ id: 'a', type: 'TEXT', text: '${input.document} / ${input.name}' }, { id: 'b', type: 'LLM', modelRef: 'mock-demo', userPrompt: '${input.document}', dependsOn: ['a'] }] })).toEqual(['document', 'name']);
  });
  it('结果不明重试复用同键，参数变化使用新键', () => {
    let n = 0;
    const identity = new SubmissionIdentity(() => `key-${++n}`);
    expect(identity.forInputs({ document: 'a', name: 'b' })).toBe('key-1');
    expect(identity.forInputs({ name: 'b', document: 'a' })).toBe('key-1');
    expect(identity.forInputs({ document: 'different', name: 'b' })).toBe('key-2');
    identity.reset();
    expect(identity.forInputs({ document: 'different', name: 'b' })).toBe('key-3');
  });
});
