# 紹介動画用の BGM と効果音を合成する (著作権フリー・自作)
import numpy as np, wave, sys, os
SR = 48000
out = sys.argv[1] if len(sys.argv) > 1 else '.media'
os.makedirs(out, exist_ok=True)

def write(name, data):
    data = np.clip(data, -1, 1)
    if data.ndim == 1: data = np.stack([data, data], 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(os.path.join(out, name), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def midi(n): return 440 * 2 ** ((n - 69) / 12)

BPM = 100; beat = 60 / BPM; bar = beat * 4
dur = 116.0
N = int(dur * SR); t = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)
# コード進行 (Cmaj7 - Am7 - Fmaj7 - G6) を 1 小節ずつ
chords = [[48, 55, 59, 64, 67], [45, 52, 55, 60, 64], [41, 48, 52, 57, 60], [43, 50, 55, 59, 64]]
rng = np.random.default_rng(1)
nbar = int(dur / bar) + 1
for b in range(nbar):
    s = int(b * bar * SR); e = min(N, int((b + 1) * bar * SR) + int(0.4 * SR))
    if s >= N: break
    tt = np.arange(e - s) / SR
    env = np.minimum(1, tt / 0.6) * np.exp(-np.maximum(0, tt - bar) * 6)
    ch = chords[b % 4]
    for i, n in enumerate(ch):
        f = midi(n)
        pad = sum(np.sin(2 * np.pi * f * k * tt * (1 + 0.002 * (i % 2))) / k ** 1.6 for k in range(1, 5))
        L[s:e] += 0.045 * env * pad * (1.1 if i % 2 else 0.9)
        R[s:e] += 0.045 * env * pad * (0.9 if i % 2 else 1.1)
    # アルペジオ (8 分音符)
    arp = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[4] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 12, ch[2] + 12]
    for k, n in enumerate(arp):
        s2 = int((b * bar + k * beat / 2) * SR); e2 = min(N, s2 + int(0.5 * SR))
        if s2 >= N: continue
        t2 = np.arange(e2 - s2) / SR
        note = (np.sin(2 * np.pi * midi(n) * t2) + 0.3 * np.sin(4 * np.pi * midi(n) * t2)) * np.exp(-t2 * 7)
        pan = 0.5 + 0.35 * np.sin(k)
        L[s2:e2] += 0.06 * note * (1 - pan); R[s2:e2] += 0.06 * note * pan
    # キック (1・3 拍) とハイハット (裏拍)。最初の 2 小節は無し
    if b >= 2:
        for k in (0, 2):
            s3 = int((b * bar + k * beat) * SR); e3 = min(N, s3 + int(0.35 * SR))
            if s3 >= N: continue
            t3 = np.arange(e3 - s3) / SR
            kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-t3 * 30)) * t3) * np.exp(-t3 * 9)
            L[s3:e3] += 0.32 * kick; R[s3:e3] += 0.32 * kick
        for k in range(4):
            s4 = int((b * bar + k * beat + beat / 2) * SR); e4 = min(N, s4 + int(0.06 * SR))
            if s4 >= N: continue
            t4 = np.arange(e4 - s4) / SR
            hat = rng.standard_normal(e4 - s4); hat = np.diff(hat, prepend=0) * np.exp(-t4 * 60)
            L[s4:e4] += 0.03 * hat; R[s4:e4] += 0.035 * hat
mix = np.stack([L, R], 1)
mix /= np.max(np.abs(mix)) / 0.7
write('guide_bgm.wav', mix)

# 効果音: シュッ (場面転換)
n = int(0.55 * SR); tt = np.arange(n) / SR
noise = rng.standard_normal(n)
sweep = np.zeros(n); acc = 0.0
cut = 0.02 + 0.5 * (tt / tt[-1])
for i in range(n):
    acc += cut[i] * (noise[i] - acc); sweep[i] = acc
env = np.sin(np.pi * np.minimum(1, tt / 0.55)) ** 2
write('guide_whoosh.wav', 0.9 * sweep / np.max(np.abs(sweep)) * env)
# 効果音: ポン (登場)
n = int(0.35 * SR); tt = np.arange(n) / SR
pop = np.sin(2 * np.pi * (900 - 500 * tt / 0.35) * tt) * np.exp(-tt * 14)
write('guide_pop.wav', 0.8 * pop)
print('ok')
