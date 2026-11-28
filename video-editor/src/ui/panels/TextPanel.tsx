import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import type { CharAnimKind, CharAnimation, Clip, TextStyle } from '../../model/types';
import { ColorField, ParamColor, ParamSlider, Section, Select, Slider, Toggle, Chips } from '../controls';
import { liveClip, updateClip } from '../params';
import { BUNDLED_FONTS, SYSTEM_FONTS, WEB_FONTS, ensureWebFont } from '../../render/fonts';
import { importFile, ACCEPT_FONT } from '../../media/import';
import { EASE_LABELS } from '../../model/keyframes';
import { Icon } from '../icons';
import { addUserPreset, clearPresetOverride, deleteUserPreset, loadPresetStore, overwriteUserPreset, setPresetOverride, usePresetStore, USER_PREFIX, type UserTextPreset } from '../../presets/userPresets';
import { PRESETS, userPresetToPreset } from '../../presets/presets';
import { PresetThumb } from './PresetThumb';
import { askConfirm, askText } from '../dialog';

const st = () => useStore.getState();

const ANIM_KINDS: [CharAnimKind, string][] = [
  ['typewriter', 'タイプライター'],
  ['fade', 'フェード'],
  ['slideUp', '下から'],
  ['slideDown', '上から'],
  ['scaleIn', '拡大'],
  ['popIn', 'ポップ'],
  ['rotateIn', '回転'],
  ['blurIn', 'ぼかし'],
  ['drop', '落下'],
  ['wave', 'ウェーブ (継続)'],
  ['shake', '振動 (継続)'],
  ['jitter', 'ゆらぎ (継続)'],
  ['colorWave', '色変化 (継続)'],
];

export type { UserTextPreset } from '../../presets/userPresets';
export { loadUserPresets } from '../../presets/userPresets';

/** text クリップは text.style、counter クリップは counter.style を編集 */
export function StyleEditor({ clip, base }: { clip: Clip; base: 'text' | 'counter' }) {
  const project = useStore((s) => s.project)!;
  const s: TextStyle = base === 'text' ? clip.text!.style : clip.counter!.style;
  const pre = base + '.style.';
  const set = (fn: (st2: TextStyle) => void, key: string) => updateClip(clip.id, (c) => fn(base === 'text' ? c.text!.style : c.counter!.style), key);
  const live = (fn: (st2: TextStyle) => void) => liveClip(clip.id, (c) => fn(base === 'text' ? c.text!.style : c.counter!.style));
  const userFonts = project.assets.filter((a) => a.kind === 'font' && a.fontFamily);
  const fontRef = useRef<HTMLInputElement>(null);
  const fontOptions: [string, string][] = [...BUNDLED_FONTS.map((f) => [f.family, f.label] as [string, string]), ...WEB_FONTS.map((f) => [f.family, f.label] as [string, string]), ...SYSTEM_FONTS.map((f) => [f.family, f.label] as [string, string]), ...userFonts.map((f) => [f.fontFamily!, '★ ' + f.name] as [string, string])];
  if (!fontOptions.some((o) => o[0] === s.fontFamily)) fontOptions.unshift([s.fontFamily, s.fontFamily]);
  return (
    <>
      <Section title="フォント">
        <Select
          label="フォント"
          value={s.fontFamily}
          options={fontOptions}
          onChange={(v) => {
            void ensureWebFont(v);
            set((x) => (x.fontFamily = v), 'font');
          }}
        />
        <button className="wide" onClick={() => fontRef.current?.click()}>
          <Icon name="plus" size={16} /> フォントファイルを追加 (.ttf / .otf / .woff)
        </button>
        <input
          ref={fontRef}
          type="file"
          accept={ACCEPT_FONT}
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const { asset } = await importFile(f);
              st().update((p) => {
                p.assets.push(asset);
                const c = p.clips.find((q) => q.id === clip.id);
                const target = c && (base === 'text' ? c.text?.style : c.counter?.style);
                if (target && asset.fontFamily) target.fontFamily = asset.fontFamily;
              });
              st().showToast('フォントを追加しました', 'ok');
            } catch (err: any) {
              st().showToast(String(err?.message ?? err), 'error');
            }
          }}
        />
        <Chips value={String(s.fontWeight)} options={[['300', '細'], ['400', '標準'], ['700', '太'], ['900', '極太']]} onChange={(v) => set((x) => (x.fontWeight = Number(v)), 'fw')} />
        <ParamSlider clip={clip} path={pre + 'fontSize'} label="サイズ" min={8} max={600} step={1} />
        <ParamSlider clip={clip} path={pre + 'letterSpacing'} label="文字間隔" min={-50} max={200} step={0.5} />
        <ParamSlider clip={clip} path={pre + 'lineHeight'} label="行間隔" min={0.6} max={3} step={0.01} />
        <Chips value={s.align} options={[['left', '左揃え'], ['center', '中央'], ['right', '右揃え']]} onChange={(v) => set((x) => (x.align = v), 'al')} />
        <Toggle label="縦書き" value={s.vertical} onChange={(v) => set((x) => (x.vertical = v), 'vt')} />
        <Toggle label="斜体" value={s.italic} onChange={(v) => set((x) => (x.italic = v), 'it')} />
      </Section>
      <Section title="塗り">
        <Chips value={s.fill.type} options={[['solid', '単色'], ['linear', 'グラデ'], ['radial', '円形グラデ'], ['metal', '金属']]} onChange={(v) => set((x) => (x.fill.type = v), 'ft')} />
        <ParamColor clip={clip} path={pre + 'fill.color'} label={s.fill.type === 'solid' ? '色' : '色1'} />
        {s.fill.type !== 'solid' && <ParamColor clip={clip} path={pre + 'fill.color2'} label="色2 (ハイライト)" />}
        {s.fill.type === 'linear' && <ParamSlider clip={clip} path={pre + 'fill.angle'} label="角度" min={-180} max={180} step={1} />}
      </Section>
      <Section title="縁取り (最大3重)">
        {s.strokes.map((sk, i) => (
          <div key={i} className="sub">
            <Toggle label={`縁取り ${i + 1}${i === 0 ? ' (内側)' : ''}`} value={sk.enabled} onChange={(v) => set((x) => (x.strokes[i].enabled = v), 'sk' + i)} />
            {sk.enabled && (
              <>
                <ColorField label="色" value={sk.color} onChange={(v) => set((x) => (x.strokes[i].color = v), 'skc' + i)} />
                <Slider label="太さ" value={sk.width} min={0} max={60} step={0.5} onLive={(v) => live((x) => (x.strokes[i].width = v))} onCommit={(v) => set((x) => (x.strokes[i].width = v), 'skw' + i)} />
              </>
            )}
          </div>
        ))}
      </Section>
      <Section title="影・発光・立体・光沢" defaultOpen={false}>
        <Toggle label="影" value={s.shadow.enabled} onChange={(v) => set((x) => (x.shadow.enabled = v), 'sh')} />
        {s.shadow.enabled && (
          <>
            <ColorField label="影の色" value={s.shadow.color} onChange={(v) => set((x) => (x.shadow.color = v), 'shc')} />
            <Slider label="ぼかし" value={s.shadow.blur} min={0} max={80} onLive={(v) => live((x) => (x.shadow.blur = v))} onCommit={(v) => set((x) => (x.shadow.blur = v), 'shb')} />
            <Slider label="X" value={s.shadow.offsetX} min={-60} max={60} onLive={(v) => live((x) => (x.shadow.offsetX = v))} onCommit={(v) => set((x) => (x.shadow.offsetX = v), 'shx')} />
            <Slider label="Y" value={s.shadow.offsetY} min={-60} max={60} onLive={(v) => live((x) => (x.shadow.offsetY = v))} onCommit={(v) => set((x) => (x.shadow.offsetY = v), 'shy')} />
          </>
        )}
        <Toggle label="発光" value={s.glow.enabled} onChange={(v) => set((x) => (x.glow.enabled = v), 'gl')} />
        {s.glow.enabled && (
          <>
            <ParamColor clip={clip} path={pre + 'glow.color'} label="発光色" />
            <ParamSlider clip={clip} path={pre + 'glow.blur'} label="広がり" min={0} max={120} />
            <ParamSlider clip={clip} path={pre + 'glow.strength'} label="発光強度" min={0} max={2} step={0.05} />
          </>
        )}
        <Toggle label="立体 (押し出し)" value={s.extrude.enabled} onChange={(v) => set((x) => (x.extrude.enabled = v), 'ex')} />
        {s.extrude.enabled && (
          <>
            <ColorField label="側面の色" value={s.extrude.color} onChange={(v) => set((x) => (x.extrude.color = v), 'exc')} />
            <Slider label="厚み" value={s.extrude.depth} min={1} max={60} onLive={(v) => live((x) => (x.extrude.depth = v))} onCommit={(v) => set((x) => (x.extrude.depth = v), 'exd')} />
            <Slider label="方向" value={s.extrude.angle} min={-180} max={180} onLive={(v) => live((x) => (x.extrude.angle = v))} onCommit={(v) => set((x) => (x.extrude.angle = v), 'exa')} />
          </>
        )}
        <Toggle label="光沢" value={s.gloss.enabled} onChange={(v) => set((x) => (x.gloss.enabled = v), 'gs')} />
        {s.gloss.enabled && <Slider label="光沢の強さ" value={s.gloss.opacity} min={0} max={1} step={0.01} onLive={(v) => live((x) => (x.gloss.opacity = v))} onCommit={(v) => set((x) => (x.gloss.opacity = v), 'gso')} />}
      </Section>
      <Section title="背景・座布団" defaultOpen={false}>
        <Toggle label="背景 (座布団)" value={s.background.enabled} onChange={(v) => set((x) => (x.background.enabled = v), 'bg')} />
        {s.background.enabled && (
          <>
            <ColorField label="色" value={s.background.color} onChange={(v) => set((x) => (x.background.color = v), 'bgc')} />
            <ColorField label="グラデ色 (任意)" value={s.background.color2 ?? ''} onChange={(v) => set((x) => (x.background.color2 = v.length >= 7 ? v : undefined), 'bgc2')} />
            <Slider label="不透明度" value={s.background.opacity} min={0} max={1} step={0.01} onLive={(v) => live((x) => (x.background.opacity = v))} onCommit={(v) => set((x) => (x.background.opacity = v), 'bgo')} />
            <Slider label="横余白" value={s.background.paddingX} min={0} max={200} onLive={(v) => live((x) => (x.background.paddingX = v))} onCommit={(v) => set((x) => (x.background.paddingX = v), 'bgx')} />
            <Slider label="縦余白" value={s.background.paddingY} min={0} max={200} onLive={(v) => live((x) => (x.background.paddingY = v))} onCommit={(v) => set((x) => (x.background.paddingY = v), 'bgy')} />
            <Slider label="角丸" value={s.background.radius} min={0} max={200} onLive={(v) => live((x) => (x.background.radius = v))} onCommit={(v) => set((x) => (x.background.radius = v), 'bgr')} />
            <Slider label="斜め" value={s.background.skew} min={-45} max={45} onLive={(v) => live((x) => (x.background.skew = v))} onCommit={(v) => set((x) => (x.background.skew = v), 'bgs')} />
            <ColorField label="枠線の色" value={s.background.borderColor ?? '#ffffff'} onChange={(v) => set((x) => (x.background.borderColor = v), 'bgbc')} />
            <Slider label="枠線の太さ" value={s.background.borderWidth ?? 0} min={0} max={30} onLive={(v) => live((x) => (x.background.borderWidth = v))} onCommit={(v) => set((x) => (x.background.borderWidth = v), 'bgbw')} />
          </>
        )}
      </Section>
    </>
  );
}

function AnimEditor({ clip }: { clip: Clip }) {
  const anims = clip.text!.anims;
  const set = (fn: (a: CharAnimation[]) => void, key: string) => updateClip(clip.id, (c) => fn(c.text!.anims), key);
  return (
    <Section title="一文字アニメーション (キネティック)">
      {anims.map((a, i) => (
        <div key={i} className="sub">
          <div className="sub-head">
            <Select label={`アニメ ${i + 1}`} value={a.kind} options={ANIM_KINDS} onChange={(v) => set((x) => (x[i].kind = v), 'ak' + i)} />
            <button className="mini" onClick={() => set((x) => x.splice(i, 1), 'adel')} aria-label="削除">
              <Icon name="trash" size={14} />
            </button>
          </div>
          <Chips value={a.mode} options={[['in', '登場'], ['out', '退場'], ['loop', '継続']]} onChange={(v) => set((x) => (x[i].mode = v), 'am' + i)} />
          <Slider label={a.mode === 'loop' ? '周期 (秒)' : '1文字の時間 (秒)'} value={a.duration} min={0.01} max={3} step={0.01} onLive={(v) => liveClip(clip.id, (c) => (c.text!.anims[i].duration = v))} onCommit={(v) => set((x) => (x[i].duration = v), 'ad' + i)} />
          <Slider label="文字ごとの遅れ (秒)" value={a.stagger} min={0} max={0.5} step={0.005} onLive={(v) => liveClip(clip.id, (c) => (c.text!.anims[i].stagger = v))} onCommit={(v) => set((x) => (x[i].stagger = v), 'as' + i)} />
          <Slider label="強さ" value={a.amount} min={0} max={3} step={0.05} onLive={(v) => liveClip(clip.id, (c) => (c.text!.anims[i].amount = v))} onCommit={(v) => set((x) => (x[i].amount = v), 'aa' + i)} />
          <Chips value={a.order} options={[['forward', '前から'], ['backward', '後ろから'], ['center', '中央から'], ['random', 'ランダム']]} onChange={(v) => set((x) => (x[i].order = v), 'ao' + i)} />
          {a.mode !== 'loop' && <Select label="イージング" value={a.ease.kind} options={Object.entries(EASE_LABELS) as any} onChange={(v) => set((x) => (x[i].ease = { kind: v as any }), 'ae' + i)} />}
        </div>
      ))}
      <button className="wide" onClick={() => set((x) => x.push({ kind: 'popIn', duration: 0.4, stagger: 0.05, order: 'forward', amount: 1, mode: 'in', ease: { kind: 'easeOut' } }), 'aadd')}>
        <Icon name="plus" size={16} /> アニメーションを追加
      </button>
    </Section>
  );
}

/** 元にしたプリセットへの上書き保存・新規保存・マイプリセットの管理 */
function PresetSaveSection({ clip }: { clip: Clip }) {
  const mine = usePresetStore((s) => s.mine);
  const overrides = usePresetStore((s) => s.overrides);
  useEffect(() => {
    void loadPresetStore();
  }, []);
  const td = clip.text!;
  const srcId = td.presetId;
  const isUser = !!srcId?.startsWith(USER_PREFIX);
  const userSrc = isUser ? mine.find((m) => USER_PREFIX + m.id === srcId) : undefined;
  const builtin = srcId && !isUser ? PRESETS.find((p) => p.id === srcId) : undefined;
  const srcName = userSrc?.name ?? builtin?.name;
  const overridden = !!(srcId && overrides[srcId]);

  const [picking, setPicking] = useState(false);
  /** 指定したプリセット (標準 / マイプリセット) を今のデザインで上書きする */
  const overwriteTo = async (targetId: string) => {
    const tUser = targetId.startsWith(USER_PREFIX) ? mine.find((m) => USER_PREFIX + m.id === targetId) : undefined;
    const tBuiltin = tUser ? undefined : PRESETS.find((p) => p.id === targetId);
    const name = tUser?.name ?? tBuiltin?.name;
    if (!name) return;
    const ok = await askConfirm(`「${name}」に上書き保存しますか？`, tBuiltin ? '標準のプリセットが今のデザインに置き換わります (あとで「標準のデザインに戻す」で戻せます)。' : 'マイプリセットが今のデザインに置き換わります。', { okLabel: '上書き保存' });
    if (!ok) return;
    if (tUser) await overwriteUserPreset(tUser.id, td.style, td.anims);
    else await setPresetOverride(targetId, td.style, td.anims);
    // 以後はこのプリセットが上書き対象
    updateClip(clip.id, (c) => (c.text!.presetId = targetId));
    setPicking(false);
    st().showToast(`「${name}」に上書き保存しました`, 'ok');
  };
  const overwrite = () => (srcId && srcName ? overwriteTo(srcId) : setPicking(true));
  const saveNew = async () => {
    const name = await askText('新しいプリセットの名前', srcName ? `${srcName.replace(/^\d+\s*/, '')} (改)` : td.content.slice(0, 10) || 'マイテロップ');
    if (!name) return;
    const id = await addUserPreset(name, td.style, td.anims);
    // 以後の上書き保存はこの新しいプリセットが対象
    updateClip(clip.id, (c) => (c.text!.presetId = USER_PREFIX + id));
    st().showToast(`「${name}」をマイプリセットに保存しました`, 'ok');
  };
  const resetBuiltin = async () => {
    if (!srcId || !builtin) return;
    if (!(await askConfirm(`「${builtin.name}」を標準のデザインに戻しますか？`, '上書き保存した内容が消えます。このクリップの見た目は変わりません。', { okLabel: '標準に戻す', danger: true }))) return;
    await clearPresetOverride(srcId);
    st().showToast('標準のデザインに戻しました', 'ok');
  };
  const applyMine = (u: (typeof mine)[number]) =>
    updateClip(clip.id, (c) => {
      c.text!.style = JSON.parse(JSON.stringify(u.style));
      c.text!.anims = JSON.parse(JSON.stringify(u.anims ?? []));
      c.text!.presetId = USER_PREFIX + u.id;
    });
  const removeMine = async (u: (typeof mine)[number]) => {
    if (!(await askConfirm(`マイプリセット「${u.name}」を削除しますか？`, 'この操作は取り消せません。使用中のテロップの見た目は変わりません。', { okLabel: '削除', danger: true }))) return;
    await deleteUserPreset(u.id);
    if (srcId === USER_PREFIX + u.id) updateClip(clip.id, (c) => (c.text!.presetId = undefined));
  };

  return (
    <Section title="プリセットに保存">
      {srcName ? (
        <p className="row-info">
          元のプリセット: <b>{srcName}</b>
          {overridden && <span className="badge">編集済み</span>}
        </p>
      ) : (
        <p className="hint">今のデザインを、既存のプリセットに上書き保存したり、新しいプリセットとして保存したりできます。</p>
      )}
      <div className="btn-row">
        <button className="accent" onClick={overwrite}>
          {srcName ? `「${srcName}」に上書き保存` : 'プリセットに上書き保存…'}
        </button>
        {srcName && <button onClick={() => setPicking(true)}>別のプリセットに上書き…</button>}
        <button onClick={saveNew}>新しいプリセットとして保存</button>
        {builtin && overridden && <button onClick={resetBuiltin}>標準のデザインに戻す</button>}
      </div>
      {mine.length > 0 && (
        <>
          <div className="fx-group-title">マイプリセット</div>
          <div className="mine-list">
            {mine.map((u) => (
              <div key={u.id} className={'mine-item' + (srcId === USER_PREFIX + u.id ? ' on' : '')}>
                <button className="mine-apply" onClick={() => applyMine(u)}>
                  <PresetThumb preset={userPresetToPreset(u)} version={u.updatedAt} />
                  <span>{u.name}</span>
                </button>
                <button className="mini" aria-label={`${u.name} を削除`} onClick={() => removeMine(u)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {picking && <OverwritePicker mine={mine} overrides={overrides} onPick={overwriteTo} onClose={() => setPicking(false)} />}
    </Section>
  );
}

/** 上書きするプリセットを見本付きで選ぶ */
function OverwritePicker({ mine, overrides, onPick, onClose }: { mine: UserTextPreset[]; overrides: Record<string, { savedAt: number }>; onPick: (id: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState<'mine' | 'ymm4' | 'other'>(mine.length ? 'mine' : 'ymm4');
  const items = cat === 'mine' ? mine.map(userPresetToPreset) : PRESETS.filter((p) => p.kind === 'text' && (cat === 'ymm4' ? p.category === 'ymm4' : p.category !== 'ymm4'));
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog picker" role="dialog" aria-modal="true" aria-label="上書きするプリセットを選ぶ" onClick={(e) => e.stopPropagation()}>
        <h3>上書きするプリセットを選ぶ</h3>
        <Chips value={cat} options={[['mine', 'マイプリセット'], ['ymm4', 'YMM4テンプレ'], ['other', 'その他のテロップ']]} onChange={setCat} />
        {items.length === 0 ? (
          <p className="hint">まだありません。「新しいプリセットとして保存」で作れます。</p>
        ) : (
          <div className="picker-grid">
            {items.map((p) => (
              <button key={p.id} className="preset text" onClick={() => onPick(p.id)}>
                <PresetThumb preset={p} version={overrides[p.id]?.savedAt ?? mine.find((m) => USER_PREFIX + m.id === p.id)?.updatedAt} />
                <span className="preset-name small">{p.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

export function TextPanel({ clip }: { clip: Clip }) {
  if (clip.type !== 'text' || !clip.text) return <div className="panel-body">テキストクリップを選択してください</div>;
  return (
    <div className="panel-body">
      <textarea
        className="text-content"
        value={clip.text.content}
        rows={3}
        placeholder="テキストを入力"
        onChange={(e) => updateClip(clip.id, (c) => (c.text!.content = e.target.value), 'content')}
      />
      <PresetSaveSection clip={clip} />
      <StyleEditor clip={clip} base="text" />
      <AnimEditor clip={clip} />
    </div>
  );
}
