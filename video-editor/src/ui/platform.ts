// 実行環境の差 (通常のブラウザ / claude.ai の Artifact 内) を吸収する
type DownloadsNs = { save(r: { filename: string; data: Blob | string | ArrayBuffer }): Promise<{ status: string }> };

/** claude.ai の Artifact ビューアー内で動いているか */
export const inArtifact = typeof window !== 'undefined' && !!(window as any).claude?.use;

let downloadsP: Promise<DownloadsNs | null> | null = null;
function downloadsNs(): Promise<DownloadsNs | null> {
  if (!inArtifact) return Promise.resolve(null);
  if (!downloadsP) downloadsP = ((window as any).claude.use('downloads') as Promise<DownloadsNs | null>).catch(() => null);
  return downloadsP;
}

export interface SaveOutcome {
  ok: boolean;
  message?: string;
}

/**
 * ファイルを保存する。Artifact 内では downloads 機能 (iPhone の Claude アプリでは共有シート) を使い、
 * 通常のブラウザでは <a download> を使う。
 */
export async function saveFile(blob: Blob, name: string): Promise<SaveOutcome> {
  const dl = await downloadsNs();
  if (dl) {
    try {
      await dl.save({ filename: name, data: blob });
      return { ok: true };
    } catch (e: any) {
      const code = e?.code as string | undefined;
      if (code === 'declined') return { ok: false };
      if (code === 'rejected_extension') return { ok: false, message: 'この形式のファイルはここでは保存できません' };
      if (code === 'host_unavailable') return { ok: false, message: 'このアプリではファイルを保存できません。ブラウザで claude.ai を開いて保存してください' };
      if (code === 'rate_limited') return { ok: false, message: '保存の確認が表示中です。少し待ってからもう一度お試しください' };
      return { ok: false, message: '保存できませんでした (' + (code ?? e?.message ?? e) + ')' };
    }
  }
  if (inArtifact) return { ok: false, message: 'この画面ではファイルを保存できません' };
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true };
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* プライベートモード等 */
  }
}
