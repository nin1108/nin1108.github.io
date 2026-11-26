import { useEffect, useState } from 'react';
import { Home } from './ui/Home';
import { Editor } from './ui/Editor';
import { useStore } from './store/store';
import { loadProject, requestPersistence } from './storage/db';
import { normalizeProject } from './model/defaults';
import { ensureFontAsset } from './media/registry';
import { ensureWebFont } from './render/fonts';

function idFromHash() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  return m ? m[1] : null;
}

export function App() {
  const [route, setRoute] = useState<string | null>(idFromHash());
  const [loading, setLoading] = useState(!!route);
  const [error, setError] = useState<string | null>(null);
  const project = useStore((s) => s.project);

  useEffect(() => {
    const onHash = () => setRoute(idFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!route) {
      useStore.getState().close();
      setLoading(false);
      return;
    }
    if (project?.id === route) return;
    setLoading(true);
    (async () => {
      try {
        const raw = await loadProject(route);
        if (!raw) throw new Error('プロジェクトが見つかりません');
        const p = normalizeProject(raw);
        void ensureWebFont('Noto Sans JP');
        for (const a of p.assets) if (a.kind === 'font') await ensureFontAsset(a).catch(() => {});
        if (cancelled) return;
        useStore.getState().load(p);
        void requestPersistence();
        localStorage.setItem('mve:last', p.id);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        location.hash = '';
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route]);

  if (loading) return <div className="splash">読み込み中…</div>;
  if (route && project) return <Editor onHome={() => (location.hash = '')} />;
  return (
    <>
      {error && <div className="toast error">{error}</div>}
      <Home onOpen={(id) => (location.hash = '#/p/' + id)} />
    </>
  );
}
