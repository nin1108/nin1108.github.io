"""BGM と効果音をその場で合成する（外部素材なし・自作）。

- BGM: ゆっくりした和音のパッド + 柔らかいアルペジオ。乱数シード固定で毎回同じ音になる。
- 効果音: whoosh / chime / pop / boom / rise / tick / shimmer / flash
- ナレーション（任意）: episode の audio/narration/*.wav があれば字幕時刻に置き、BGMを下げる（ダッキング）。
出力: 48kHz ステレオ 16bit WAV
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np

SR = 48000


def _env(n, a=0.01, r=0.3):
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(a, 1e-4))
    e *= np.exp(-t / max(r, 1e-4))
    return e


def _lp(x, alpha):
    """1次ローパス（簡易）。"""
    y = np.empty_like(x)
    acc = 0.0
    a = float(alpha)
    for i in range(len(x)):
        acc += a * (x[i] - acc)
        y[i] = acc
    return y


def _lp_fast(x, k):
    k = max(1, int(k))
    ker = np.ones(k) / k
    for _ in range(3):  # 3回かけてガウス状にし、高域の漏れ（サイドローブ）を抑える
        x = np.convolve(x, ker, mode="same")
    return x


def noise(n, rng):
    return rng.standard_normal(n).astype(np.float64)


def sfx(kind: str, rng) -> np.ndarray:
    if kind in ("whoosh", "whoosh_long"):
        dur = 0.7 if kind == "whoosh" else 1.4
        n = int(SR * dur)
        t = np.linspace(0, 1, n)
        x = noise(n, rng)
        # 帯域が上がって下がる：移動平均幅を時間で変える
        y = np.zeros(n)
        for i, k in enumerate((120, 80, 55, 38, 28)):
            y += _lp_fast(x, k) * np.exp(-((t - (0.25 + i * 0.1)) ** 2) / 0.02)
        env = np.sin(np.pi * t) ** 1.5
        return 1.6 * y * env
    if kind in ("chime", "chime_hi", "chime_low"):
        f0 = {"chime": 880.0, "chime_hi": 1318.5, "chime_low": 659.3}[kind]
        n = int(SR * 2.2)
        t = np.arange(n) / SR
        y = sum(a * np.sin(2 * np.pi * f0 * m * t) * np.exp(-t * d) for m, a, d in ((1, 1, 2.2), (2.01, 0.35, 3.5), (3.0, 0.15, 5)))
        return 0.28 * y * np.minimum(1, t / 0.004)
    if kind == "pop":
        n = int(SR * 0.18)
        t = np.arange(n) / SR
        f = 900 * np.exp(-t * 18) + 300
        ph = 2 * np.pi * np.cumsum(f) / SR
        return 0.22 * np.sin(ph) * _env(n, 0.002, 0.05)
    if kind == "tick":
        n = int(SR * 0.08)
        return 0.3 * _lp_fast(noise(n, rng), 6) * _env(n, 0.001, 0.012)
    if kind == "boom":
        n = int(SR * 1.6)
        t = np.arange(n) / SR
        f = 70 * np.exp(-t * 1.5) + 38
        ph = 2 * np.pi * np.cumsum(f) / SR
        return 0.55 * np.sin(ph) * _env(n, 0.005, 0.55)
    if kind in ("rise", "rise_long"):
        dur = 1.6 if kind == "rise" else 3.0
        n = int(SR * dur)
        t = np.arange(n) / SR
        f = 220 * (2 ** (t / dur * 1.0))
        ph = 2 * np.pi * np.cumsum(f) / SR
        y = 0.12 * (np.sin(ph) + 0.5 * np.sin(2 * ph)) * (t / dur) ** 2 * np.minimum(1, (dur - t) / 0.1)
        y += 0.12 * _lp_fast(noise(n, rng), 60) * (t / dur) ** 2
        return y
    if kind == "shimmer":
        n = int(SR * 2.0)
        t = np.arange(n) / SR
        y = np.zeros(n)
        for i, f in enumerate((1046.5, 1318.5, 1568.0, 2093.0)):
            st = int(i * 0.06 * SR)
            tt = t[: n - st]
            y[st:] += np.sin(2 * np.pi * f * tt) * np.exp(-tt * 2.5) * 0.08
        return y
    if kind == "flash":
        n = int(SR * 0.5)
        return 0.5 * _lp_fast(noise(n, rng), 30) * _env(n, 0.003, 0.12)
    raise ValueError(kind)


def music(duration: float, rng, bpm=84) -> np.ndarray:
    """A短調系のゆっくりしたパッド（Am - F - C - G）＋アルペジオ。"""
    n = int(SR * duration)
    t = np.arange(n) / SR
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # MIDI
    bar = 60 / bpm * 4
    out_l = np.zeros(n)
    out_r = np.zeros(n)

    def hz(m):
        return 440.0 * 2 ** ((m - 69) / 12)

    nb = int(np.ceil(duration / bar)) + 1
    for b in range(nb):
        ch = chords[b % 4]
        s = int(b * bar * SR)
        e = min(n, int((b + 1) * bar * SR + 0.8 * SR))
        if s >= n:
            break
        tt = t[s:e] - t[s]
        L = e - s
        env = np.minimum(1, tt / 0.9) * np.minimum(1, (L / SR - tt) / 0.8)
        for i, m in enumerate(ch):
            for det, pan in ((-0.07, 0.3), (0.07, 0.7)):
                f = hz(m - 12) * (1 + det / 100)
                w = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt)
                out_l[s:e] += 0.05 * w * env * (1 - pan)
                out_r[s:e] += 0.05 * w * env * pan
        # 低音
        f = hz(ch[0] - 24)
        out_l[s:e] += 0.06 * np.sin(2 * np.pi * f * tt) * env
        out_r[s:e] += 0.06 * np.sin(2 * np.pi * f * tt) * env
        # アルペジオ（8分音符）
        step = 60 / bpm / 2
        for k in range(8):
            st = s + int(k * step * SR)
            if st >= n:
                break
            m = ch[[0, 1, 2, 1, 2, 0, 1, 2][k]] + 12
            ln = min(n - st, int(0.9 * SR))
            tk = np.arange(ln) / SR
            y = np.sin(2 * np.pi * hz(m) * tk) * np.exp(-tk * 4.5) * np.minimum(1, tk / 0.004) * 0.035
            pan = 0.35 if k % 2 else 0.65
            out_l[st:st + ln] += y * (1 - pan)
            out_r[st:st + ln] += y * pan
    fade = np.minimum(1, t / 0.6) * np.minimum(1, (duration - t) / 0.8)
    return np.stack([out_l * fade, out_r * fade], axis=1)


def read_wav(p: Path) -> np.ndarray:
    with wave.open(str(p)) as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float64) / 32768
    x = x.reshape(-1, ch)
    if ch == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != SR:
        idx = np.arange(int(len(x) * SR / sr)) * sr / SR
        x = np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1)
    return x


def write_wav(p: Path, x: np.ndarray):
    x = np.clip(x, -1, 1)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def build_mix(duration, sfx_events, out_path: Path, narration=None, seed=1):
    """narration: [(start_sec, wav_path)] があればダッキングして重ねる。"""
    rng = np.random.default_rng(seed)
    n = int(SR * duration)
    bgm = music(duration, rng) * 0.9
    mix = np.zeros((n, 2))
    duck = np.ones(n)
    if narration:
        for st, p in narration:
            v = read_wav(Path(p))
            s = int(st * SR)
            e = min(n, s + len(v))
            mix[s:e] += v[: e - s] * 0.95
            a, b = max(0, s - int(0.15 * SR)), min(n, e + int(0.25 * SR))
            duck[a:b] = 0.35
        duck = _lp_fast(duck, int(0.1 * SR))
    mix += bgm * duck[:, None]
    for st, kind in sfx_events:
        y = sfx(kind, rng)
        s = int(st * SR)
        e = min(n, s + len(y))
        pan = 0.5
        mix[s:e, 0] += y[: e - s] * (1 - pan) * 1.4
        mix[s:e, 1] += y[: e - s] * pan * 1.4
    peak = np.abs(mix).max()
    if peak > 0.95:
        mix *= 0.95 / peak
    write_wav(out_path, mix)
    return {"duration": duration, "peak_before_norm": float(peak), "sfx": len(sfx_events),
            "narration_clips": len(narration or [])}


if __name__ == "__main__":
    import sys
    d = json.loads(sys.argv[1])
    print(build_mix(d["duration"], d["sfx"], Path(d["out"])))
