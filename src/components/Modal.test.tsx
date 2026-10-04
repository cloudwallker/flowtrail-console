// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('由父组件决定关闭，取消事件不会把等待操作的对话框静默关闭', () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  render(<Modal title="等待操作" onClose={() => undefined}><p>操作尚未完成</p></Modal>);
  const event = new Event('cancel', { bubbles: false, cancelable: true });
  const dialog = screen.getByRole('dialog') as HTMLDialogElement;
  dialog.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(dialog.open).toBe(true);
});
