import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({ title, onClose, children, drawer = false }: { title: string; onClose: () => void; children: React.ReactNode; drawer?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  return <dialog ref={dialog} className={drawer ? 'modal drawer' : 'modal'} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="关闭" autoFocus onClick={onClose}><X size={20} /></button></div>{children}</dialog>;
}
