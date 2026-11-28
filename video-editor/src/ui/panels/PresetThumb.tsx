// テロップ プリセットの見本 (「あア」を実際の描画処理で描いた画像)
import { useEffect, useState } from 'react';
import type { Clip } from '../../model/types';
import type { Preset } from '../../presets/presets';
import { defaultTextStyle } from '../../model/defaults';
import { renderText, fontString } from '../../render/text';
import { ensureWebFont } from '../../render/fonts';

const cache = new Map<string, string>();

async function makeThumb(p: Preset): Promise<string> {
  const hit = cache.get(p.id);
  if (hit) return hit;
  const tmp = { type: 'text', text: { content: '', style: defaultTextStyle(), anims: [] } } as unknown as Clip;
  p.apply!(tmp, {} as any);
  const st = { ...tmp.text!.style, background: { ...tmp.text!.style.background } };
  await ensureWebFont(st.fontFamily);
  try {
    await document.fonts.load(fontString(st, 64), 'あア');
  } catch {
    /* フォールバックで描画 */
  }
  // 見本はサイズを揃えて描く (プリセット本来の大きさの比率は保つ)
  const r = renderText(undefined, 'あア', st, [], 0, 1, 0.42);
  const url = r.canvas.toDataURL('image/png');
  cache.set(p.id, url);
  return url;
}

export function PresetThumb({ preset }: { preset: Preset }) {
  const [url, setUrl] = useState<string | null>(cache.get(preset.id) ?? null);
  useEffect(() => {
    let alive = true;
    if (!url) void makeThumb(preset).then((u) => alive && setUrl(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [preset.id]);
  return <span className="preset-thumb">{url ? <img src={url} alt="" /> : <span className="preset-thumb-ph">あア</span>}</span>;
}
