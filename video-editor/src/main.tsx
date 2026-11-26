import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import * as store from './store/store';
import * as actions from './ui/actions';
import { engine } from './ui/engine';
import * as defaults from './model/defaults';
import { Compositor } from './render/compositor';
import { ExportFrameSource } from './media/video';
import * as proxy from './media/proxy';
import * as registry from './media/registry';

// iOS のダブルタップ拡大・ピンチによるページ拡大を防止 (アプリ内のピンチ操作を優先)
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false } as any);
document.addEventListener('dblclick', (e) => {
  if (!(e.target as HTMLElement)?.closest('input,textarea')) e.preventDefault();
}, { passive: false });

// 想定外のエラーを利用者に表示 (データは自動保存済み)
window.addEventListener('error', (e) => console.error('[error]', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandledrejection]', e.reason));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

// 自動テスト・デバッグ用ハンドル (動作には影響しない)
(window as any).__MVE__ = { store, actions, engine, defaults, Compositor, ExportFrameSource, proxy, registry };

createRoot(document.getElementById('root')!).render(<App />);
