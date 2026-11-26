// アプリ内ダイアログ。window.confirm / prompt / alert は埋め込み環境 (claude.ai の Artifact 等) で
// 動作しないため使わない。
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

interface DialogReq {
  title: string;
  message?: string;
  okLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  input?: string;
  resolve: (v: string | boolean | null) => void;
}

const useDialog = create<{ req: DialogReq | null }>(() => ({ req: null }));

function open(r: Omit<DialogReq, 'resolve'>): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    useDialog.getState().req?.resolve(null);
    useDialog.setState({ req: { ...r, resolve } });
  });
}

/** 確認 (OK で true) */
export async function askConfirm(title: string, message?: string, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return (await open({ title, message, okLabel: opts.okLabel ?? 'OK', cancelLabel: 'キャンセル', danger: opts.danger })) === true;
}

/** 文字入力 (キャンセルで null) */
export async function askText(title: string, initial = '', okLabel = '保存'): Promise<string | null> {
  const v = await open({ title, okLabel, cancelLabel: 'キャンセル', input: initial });
  return typeof v === 'string' ? v : null;
}

/** お知らせ */
export async function notify(title: string, message?: string): Promise<void> {
  await open({ title, message, okLabel: 'OK' });
}

export function DialogHost() {
  const req = useDialog((s) => s.req);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (req?.input != null) {
      setText(req.input);
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [req]);
  if (!req) return null;
  const close = (v: string | boolean | null) => {
    useDialog.setState({ req: null });
    req.resolve(v);
  };
  return (
    <div className="dialog-backdrop" onClick={() => close(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          close(req.input != null ? text.trim() || null : true);
        }}
      >
        <h3>{req.title}</h3>
        {req.message && <p>{req.message}</p>}
        {req.input != null && <input id="dialog-input" ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} />}
        <div className="btn-row">
          {req.cancelLabel && (
            <button type="button" onClick={() => close(null)}>
              {req.cancelLabel}
            </button>
          )}
          <button type="submit" className={req.danger ? 'danger' : 'accent'}>
            {req.okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
