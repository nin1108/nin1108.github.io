import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import type { Clip } from '../model/types';
import { findKeyAt } from '../model/keyframes';
import { localT, paramValue, setParam, toggleKeyframe } from './params';
import { Icon } from './icons';

function useNativeChange(ref: React.RefObject<HTMLInputElement | null>, fn: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('change', fn);
    return () => el.removeEventListener('change', fn);
  });
}

export function KeyButton({ clip, path }: { clip: Clip; path: string }) {
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.project?.fps ?? 30);
  const kfs = clip.keyframes[path];
  const on = !!findKeyAt(kfs, localT(clip, time), fps);
  const has = !!kfs?.length;
  return (
    <button className={'kf-btn' + (on ? ' on' : has ? ' has' : '')} title={on ? 'キーフレームを削除' : 'キーフレームを追加'} aria-label="キーフレーム" onClick={() => toggleKeyframe(clip.id, path)}>
      <Icon name="diamond" size={16} />
    </button>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
  extra?: ReactNode;
  /** 表示倍率 (例: 0..1 を 0..100% で表示) */
  display?: number;
}

export function Slider({ label, value, min, max, step = 1, unit = '', onLive, onCommit, extra, display = 1 }: SliderProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const active = useRef(false);
  const store = useStore.getState;
  const begin = () => {
    if (!active.current) {
      active.current = true;
      store().beginGesture();
    }
  };
  const end = () => {
    if (active.current) {
      active.current = false;
      store().endGesture();
    }
  };
  useNativeChange(ref, end);
  useEffect(() => () => end(), []);
  const shown = Math.round(value * display * 1000) / 1000;
  const v = Number.isFinite(value) ? value : 0;
  return (
    <div className="ctl slider">
      <div className="ctl-head">
        <span className="ctl-label">{label}</span>
        <input
          className="num"
          inputMode="decimal"
          value={text ?? String(shown)}
          onFocus={(e) => {
            setText(String(shown));
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text != null) {
              const n = Number(text.replace(/[^\d.+-eE]/g, ''));
              if (Number.isFinite(n)) onCommit(n / display);
            }
            setText(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {unit && <span className="unit">{unit}</span>}
        {extra}
      </div>
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, v))}
        onPointerDown={begin}
        onTouchStart={begin}
        onChange={(e) => {
          begin();
          onLive(Number(e.target.value));
        }}
        onPointerUp={end}
        onTouchEnd={end}
      />
    </div>
  );
}

export function ParamSlider({ clip, path, label, min, max, step, unit, keyable = true, fallback = 0, display }: { clip: Clip; path: string; label: string; min: number; max: number; step?: number; unit?: string; keyable?: boolean; fallback?: number; display?: number }) {
  const time = useStore((s) => s.time);
  const v = paramValue(clip, path, time);
  const value = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : fallback;
  return (
    <Slider
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      display={display}
      onLive={(n) => setParam(clip.id, path, n, { live: true })}
      onCommit={(n) => setParam(clip.id, path, n)}
      extra={keyable ? <KeyButton clip={clip} path={path} /> : undefined}
    />
  );
}

export function ColorField({ label, value, onChange, extra }: { label: string; value: string; onChange: (v: string) => void; extra?: ReactNode }) {
  const hex = (value || '#000000').slice(0, 7);
  return (
    <div className="ctl color">
      <span className="ctl-label">{label}</span>
      <label className="swatch" style={{ background: value }}>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value + (value.length === 9 ? value.slice(7) : ''))} />
      </label>
      <input className="hex" value={value} onChange={(e) => /^#[0-9a-fA-F]{0,8}$/.test(e.target.value) && onChange(e.target.value)} />
      {extra}
    </div>
  );
}

export function ParamColor({ clip, path, label, keyable = true }: { clip: Clip; path: string; label: string; keyable?: boolean }) {
  const time = useStore((s) => s.time);
  const v = String(paramValue(clip, path, time) ?? '#ffffff');
  return <ColorField label={label} value={v} onChange={(c) => setParam(clip.id, path, c)} extra={keyable ? <KeyButton clip={clip} path={path} /> : undefined} />;
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ctl toggle">
      <span className="ctl-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="ctl select">
      <span className="ctl-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={'sec' + (open ? ' open' : '')}>
      <header onClick={() => setOpen(!open)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="sec-title">{title}</span>
        <span className="sec-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </span>
      </header>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map(([v, l]) => (
        <button key={v} className={'chip' + (v === value ? ' on' : '')} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
