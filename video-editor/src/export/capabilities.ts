// 端末の書き出し能力を判定する (4K などの高負荷設定は対応端末でのみ選択可能にする)
export interface ResolutionOption {
  label: string;
  short: number; // 短辺
}

export const RESOLUTIONS: ResolutionOption[] = [
  { label: '720p', short: 720 },
  { label: '1080p', short: 1080 },
  { label: '1440p', short: 1440 },
  { label: '4K', short: 2160 },
];

export interface Caps {
  webcodecs: boolean;
  aacNative: boolean;
  mediaRecorder: boolean;
  mediaRecorderMp4: boolean;
  maxTexture: number;
  deviceMemory: number | null;
  cores: number;
  isIOS: boolean;
  isSafari: boolean;
  opfsWritable: boolean;
  /** key: `${w}x${h}@${fps}` */
  supported: Record<string, boolean>;
}

export function dimsFor(aspectW: number, aspectH: number, short: number): [number, number] {
  // 短辺を基準に、偶数ピクセルに丸める (H.264 の制約)
  let w: number;
  let h: number;
  if (aspectW >= aspectH) {
    h = short;
    w = Math.round((short * aspectW) / aspectH);
  } else {
    w = short;
    h = Math.round((short * aspectH) / aspectW);
  }
  return [w - (w % 2), h - (h % 2)];
}

const cache = new Map<string, Promise<Caps>>();

export function detectCaps(projectW: number, projectH: number): Promise<Caps> {
  const ck = `${projectW}x${projectH}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const pr = (async () => {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|Chromium|Edg|FxiOS/.test(ua);
    let maxTexture = 4096;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (gl) {
        maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        (gl.getExtension('WEBGL_lose_context') as any)?.loseContext?.();
      }
    } catch {
      /* */
    }
    const caps: Caps = {
      webcodecs: typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined',
      aacNative: false,
      mediaRecorder: typeof MediaRecorder !== 'undefined',
      mediaRecorderMp4: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('video/mp4'),
      maxTexture,
      deviceMemory: (navigator as any).deviceMemory ?? null,
      cores: navigator.hardwareConcurrency || 2,
      isIOS,
      isSafari,
      opfsWritable: false,
      supported: {},
    };
    try {
      const root = await navigator.storage?.getDirectory?.();
      if (root) {
        const fh = await root.getFileHandle('__probe.bin', { create: true });
        caps.opfsWritable = typeof (fh as any).createWritable === 'function';
        await root.removeEntry('__probe.bin').catch(() => {});
      }
    } catch {
      caps.opfsWritable = false;
    }
    if (caps.webcodecs) {
      try {
        const mb = await import('mediabunny');
        caps.aacNative = await mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 });
        for (const r of RESOLUTIONS) {
          for (const fps of [24, 30, 60]) {
            const [w, h] = dimsFor(projectW, projectH, r.short);
            const key = `${w}x${h}@${fps}`;
            if (Math.max(w, h) > maxTexture) {
              caps.supported[key] = false;
              continue;
            }
            const bitrate = recommendedBitrate(w, h, fps);
            let ok = false;
            try {
              ok = await mb.canEncodeVideo('avc', { width: w, height: h, bitrate });
              if (ok && typeof VideoEncoder.isConfigSupported === 'function') {
                const level = w * h > 2228224 ? 'avc1.640034' : w * h > 921600 ? 'avc1.64002a' : 'avc1.64001f';
                const r2 = await VideoEncoder.isConfigSupported({ codec: level, width: w, height: h, bitrate, framerate: fps }).catch(() => null);
                if (r2 && r2.supported === false) {
                  const r3 = await VideoEncoder.isConfigSupported({ codec: 'avc1.640033', width: w, height: h, bitrate, framerate: fps }).catch(() => null);
                  ok = !!r3?.supported;
                }
              }
            } catch {
              ok = false;
            }
            // 4K はメモリが少ない端末では無効 (iOS Safari のメモリ制限対策)
            if (ok && r.short >= 2160) {
              if (caps.deviceMemory != null && caps.deviceMemory < 4) ok = false;
              if (isIOS && maxTexture < 8192) ok = false;
            }
            caps.supported[key] = ok;
          }
        }
      } catch (e) {
        console.warn('capability probe failed', e);
      }
    }
    return caps;
  })();
  cache.set(ck, pr);
  return pr;
}

export function resetCaps() {
  cache.clear();
}

export function recommendedBitrate(w: number, h: number, fps: number): number {
  // 1080p30 ≒ 12Mbps, 1080p60 ≒ 18Mbps を基準
  const px = w * h;
  const base = (px / (1920 * 1080)) * 12_000_000;
  return Math.round(base * (fps >= 50 ? 1.5 : fps <= 24 ? 0.85 : 1));
}
