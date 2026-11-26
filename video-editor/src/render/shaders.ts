// GLSL ES 3.00 シェーダー群。すべてのテクスチャはプリマルチプライドアルファで扱う。

export const VS_FULL = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = a_pos; gl_Position = vec4(a_pos*2.0-1.0, 0.0, 1.0); }`;

export const VS_LAYER = `#version 300 es
layout(location=0) in vec2 a_pos;
uniform mat4 u_mvp;
uniform vec4 u_rect;   // ローカル座標の矩形 x0,y0,x1,y1 (px)
uniform vec4 u_uvRect; // 対応する素材 UV u0,v0,u1,v1
out vec2 v_uv;
void main(){
  vec2 p = mix(u_rect.xy, u_rect.zw, a_pos);
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_pos);
  gl_Position = u_mvp * vec4(p, 0.0, 1.0);
}`;

const COMMON = `
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 unpm(vec4 c){ return c.a > 0.0001 ? c.rgb / c.a : vec3(0.0); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float hash1(float n){ return fract(sin(n)*43758.5453123); }
`;

export const FS_LAYER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform float u_alphaMul;
uniform vec2 u_srcSize;
uniform float u_time;
// chroma key
uniform int u_ck; uniform vec3 u_ckColor; uniform float u_ckTol; uniform float u_ckSoft; uniform float u_ckSpill;
// mask
uniform int u_mask; uniform int u_maskEllipse; uniform int u_maskInvert;
uniform vec4 u_maskRect; uniform float u_maskRound; uniform float u_maskFeather;
// grade
uniform int u_grade;
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_vibrance, u_temp, u_tint, u_hue;
uniform float u_highlights, u_shadows, u_whites, u_blacks, u_fade, u_vignette, u_vignetteSize, u_grain;
uniform int u_useCurves; uniform sampler2D u_curves;
uniform int u_useLut; uniform sampler2D u_lut; uniform float u_lutSize; uniform float u_lutMix;
${COMMON}
vec3 rgb2ycc(vec3 c){ return vec3(luma(c), (c.b-luma(c))*0.5389, (c.r-luma(c))*0.635); }
vec3 hueShift(vec3 c, float deg){
  float a = radians(deg);
  const mat3 toYIQ = mat3(0.299,0.596,0.211, 0.587,-0.274,-0.523, 0.114,-0.322,0.312);
  const mat3 toRGB = mat3(1.0,1.0,1.0, 0.956,-0.272,-1.106, 0.621,-0.647,1.703);
  vec3 yiq = toYIQ * c;
  float h = atan(yiq.z, yiq.y) + a; float ch = length(yiq.yz);
  yiq.y = ch*cos(h); yiq.z = ch*sin(h);
  return toRGB * yiq;
}
vec3 sampleLut(vec3 c){
  float n = u_lutSize;
  c = clamp(c, 0.0, 1.0) * (n - 1.0);
  float b0 = floor(c.b); float b1 = min(b0 + 1.0, n - 1.0); float fb = c.b - b0;
  vec2 px0 = vec2((c.r + b0*n + 0.5) / (n*n), (c.g + 0.5) / n);
  vec2 px1 = vec2((c.r + b1*n + 0.5) / (n*n), (c.g + 0.5) / n);
  return mix(texture(u_lut, px0).rgb, texture(u_lut, px1).rgb, fb);
}
vec3 grade(vec3 c, vec2 uv){
  c *= exp2(u_exposure);
  // ホワイトバランス (色温度/色かぶり)
  c *= vec3(1.0 + u_temp*0.25, 1.0 - u_tint*0.18, 1.0 - u_temp*0.25);
  c *= vec3(1.0 + u_tint*0.1, 1.0, 1.0 + u_tint*0.1);
  float l = luma(c);
  // ハイライト/シャドウ
  float hiMask = smoothstep(0.45, 1.0, l);
  float shMask = 1.0 - smoothstep(0.0, 0.55, l);
  c += c * u_highlights * hiMask * 0.6;
  c += (vec3(1.0) - c) * max(u_shadows, 0.0) * shMask * 0.5 + c * min(u_shadows, 0.0) * shMask * 0.6;
  // 白/黒レベル
  float lo = -u_blacks * 0.15; float hi = 1.0 - u_whites * 0.25;
  c = (c - lo) / max(hi - lo, 0.05);
  c += u_brightness * 0.35;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  if (u_hue != 0.0) c = hueShift(c, u_hue);
  l = luma(c);
  float sat = max(max(c.r,c.g),c.b) - min(min(c.r,c.g),c.b);
  c = mix(vec3(l), c, 1.0 + u_saturation + u_vibrance * (1.0 - clamp(sat*1.5,0.0,1.0)));
  c = max(c, 0.0);
  if (u_useCurves == 1) {
    vec3 cc = clamp(c, 0.0, 1.0);
    c = vec3(texture(u_curves, vec2(cc.r*255.0/256.0+0.5/256.0, 0.5)).r,
             texture(u_curves, vec2(cc.g*255.0/256.0+0.5/256.0, 0.5)).g,
             texture(u_curves, vec2(cc.b*255.0/256.0+0.5/256.0, 0.5)).b);
  }
  if (u_useLut == 1) c = mix(c, sampleLut(c), u_lutMix);
  c = mix(c, c * 0.88 + 0.07, u_fade);
  if (u_vignette > 0.0) {
    vec2 d = (uv - 0.5) * vec2(u_srcSize.x / max(u_srcSize.x, u_srcSize.y), u_srcSize.y / max(u_srcSize.x, u_srcSize.y)) * 2.0;
    float v = smoothstep(0.2 + u_vignetteSize, 1.4 + u_vignetteSize*0.4, length(d) * 1.2);
    c *= 1.0 - v * u_vignette;
  }
  if (u_grain > 0.0) c += (hash(uv * u_srcSize + fract(u_time*7.13)*100.0) - 0.5) * u_grain * 0.35;
  return clamp(c, 0.0, 1.0);
}
float sdRoundBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  if (v_uv.x < 0.0 || v_uv.y < 0.0 || v_uv.x > 1.0 || v_uv.y > 1.0) discard;
  vec4 s = texture(u_tex, v_uv);
  float a = s.a;
  vec3 c = unpm(s);
  if (u_ck == 1) {
    vec3 k = rgb2ycc(u_ckColor); vec3 p = rgb2ycc(c);
    float d = distance(p.yz, k.yz) * 2.2 + abs(p.x - k.x) * 0.15;
    float m = smoothstep(u_ckTol, u_ckTol + u_ckSoft + 0.0001, d);
    a *= m;
    // スピル除去: キー色方向の色差を取り除く
    float spill = (1.0 - smoothstep(u_ckTol, u_ckTol + u_ckSoft + 0.35, d)) * u_ckSpill;
    c = mix(c, vec3(luma(c)), spill);
  }
  if (u_grade == 1) c = grade(c, v_uv);
  if (u_mask == 1) {
    vec2 px = (v_uv - u_maskRect.xy) * u_srcSize;
    vec2 half_ = u_maskRect.zw * u_srcSize * 0.5;
    float d;
    if (u_maskEllipse == 1) { d = (length(px / max(half_, vec2(1.0))) - 1.0) * min(half_.x, half_.y); }
    else d = sdRoundBox(px, half_, u_maskRound * min(half_.x, half_.y));
    float f = max(u_maskFeather * min(half_.x, half_.y), 0.75);
    float m = 1.0 - smoothstep(-f, f, d);
    if (u_maskInvert == 1) m = 1.0 - m;
    a *= m;
  }
  o = vec4(c * a, a) * u_alphaMul;
}`;

export const FS_COPY = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform float u_mul;
void main(){ o = texture(u_tex, v_uv) * u_mul; }`;

export const FS_PRESENT = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec3 u_bg;
void main(){ vec4 c = texture(u_tex, v_uv); o = vec4(c.rgb + u_bg*(1.0-c.a), 1.0); }`;

// 可変半径の分離型ガウシアンブラー (tilt-shift 用の空間可変モードあり)
export const FS_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_res; uniform vec2 u_dir; uniform float u_sigma;
uniform int u_tilt; uniform float u_focus; uniform float u_range; uniform float u_angle; uniform int u_radial;
void main(){
  float sigma = u_sigma;
  if (u_tilt == 1) {
    vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
    float d;
    if (u_radial == 1) d = length((p - vec2(0.5, u_focus)) * vec2(u_res.x/u_res.y, 1.0));
    else { vec2 n = vec2(-sin(radians(u_angle)), cos(radians(u_angle))); d = abs(dot(p - vec2(0.5, u_focus), n)); }
    sigma *= smoothstep(u_range*0.5, u_range*0.5 + 0.25, d);
  }
  if (sigma < 0.3) { o = texture(u_tex, v_uv); return; }
  const int N = 16;
  float step_ = max(1.0, sigma * 3.0 / float(N));
  vec2 dir = u_dir / u_res * step_;
  vec4 sum = texture(u_tex, v_uv);
  float wsum = 1.0;
  for (int i = 1; i <= N; i++) {
    float x = float(i) * step_;
    float w = exp(-0.5 * x * x / (sigma * sigma));
    sum += (texture(u_tex, v_uv + dir * float(i)) + texture(u_tex, v_uv - dir * float(i))) * w;
    wsum += 2.0 * w;
  }
  o = sum / wsum;
}`;

export const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform float u_threshold;
${COMMON}
void main(){ vec4 c = texture(u_tex, v_uv); float l = luma(unpm(c)); o = c * smoothstep(u_threshold - 0.05, u_threshold + 0.1, l); }`;

// グロー / ネオン / シャドウ / 光線 の合成
export const FS_COMBINE = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform sampler2D u_aux; uniform sampler2D u_aux2;
uniform int u_mode; uniform vec3 u_color; uniform float u_intensity; uniform float u_tint; uniform float u_core;
uniform vec2 u_offset; uniform float u_opacity; uniform float u_time; uniform float u_flicker;
${COMMON}
vec4 addPM(vec4 base, vec3 add){ vec3 rgb = base.rgb + add; float a = max(base.a, min(1.0, max(max(rgb.r, rgb.g), rgb.b))); return vec4(min(rgb, vec3(a)), a); }
void main(){
  vec4 c = texture(u_tex, v_uv);
  if (u_mode == 0) { // glow
    vec4 g = texture(u_aux, v_uv);
    vec3 tinted = mix(g.rgb, u_color * max(max(g.r, g.g), g.b), u_tint);
    o = addPM(c, tinted * u_intensity);
  } else if (u_mode == 1) { // neon
    float fl = 1.0 - u_flicker * step(0.6, hash1(floor(u_time * 14.0))) * 0.7;
    float a1 = texture(u_aux, v_uv).a; float a2 = texture(u_aux2, v_uv).a;
    vec3 core = mix(c.rgb, vec3(c.a), u_core);
    vec3 glow = u_color * (a1 * 0.9 + a2 * 0.6) * u_intensity * fl;
    o = addPM(vec4(core * fl + c.rgb * (1.0 - fl), c.a), glow);
  } else if (u_mode == 2) { // drop shadow
    float sa = texture(u_aux, v_uv - u_offset).a * u_opacity;
    o = c + vec4(u_color * sa, sa) * (1.0 - c.a);
  }
}`;

export const FS_RAYS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_light; uniform float u_length; uniform float u_intensity; uniform float u_threshold; uniform vec3 u_color;
${COMMON}
void main(){
  vec4 c = texture(u_tex, v_uv);
  vec2 L = vec2(u_light.x, 1.0 - u_light.y);
  vec2 d = (v_uv - L) * u_length / 48.0;
  vec2 uv = v_uv; float decay = 1.0; vec3 acc = vec3(0.0);
  for (int i = 0; i < 48; i++) {
    uv -= d;
    vec4 s = texture(u_tex, uv);
    float b = smoothstep(u_threshold, u_threshold + 0.2, luma(unpm(s))) * s.a;
    acc += s.rgb * b * decay;
    decay *= 0.96;
  }
  acc = acc / 48.0 * u_intensity * 3.0 * mix(vec3(1.0), u_color, 0.7);
  vec3 rgb = c.rgb + acc; float a = max(c.a, min(1.0, max(max(rgb.r,rgb.g),rgb.b)));
  o = vec4(min(rgb, vec3(a)), a);
}`;

// 1 パスで完結するエフェクト群
export const FS_FX = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_time; uniform int u_type;
uniform vec4 u_p; uniform vec4 u_q; uniform vec3 u_c1; uniform vec3 u_c2;
${COMMON}
vec4 tex(vec2 uv){ return texture(u_tex, uv); }
vec2 topUV(){ return vec2(v_uv.x, 1.0 - v_uv.y); }
void main(){
  vec2 uv = v_uv;
  vec4 c = tex(uv);
  float asp = u_res.x / u_res.y;
  if (u_type == 1) { // radial (zoom) blur: p.x=amount p.y,p.z=center
    vec2 ctr = vec2(u_p.y, 1.0 - u_p.z); vec4 s = vec4(0.0);
    for (int i = 0; i < 32; i++) { float k = 1.0 - u_p.x * float(i) / 31.0 * 0.5; s += tex(ctr + (uv - ctr) * k); }
    o = s / 32.0;
  } else if (u_type == 2) { // directional blur: p.x=length px, p.y=angle
    vec2 d = vec2(cos(radians(u_p.y)), -sin(radians(u_p.y))) * u_p.x / u_res; vec4 s = vec4(0.0);
    for (int i = 0; i < 32; i++) { float k = float(i) / 31.0 - 0.5; s += tex(uv + d * k); }
    o = s / 32.0;
  } else if (u_type == 3) { // rgb split: p.x=amount px p.y=angle
    vec2 d = vec2(cos(radians(u_p.y)), -sin(radians(u_p.y))) * u_p.x / u_res;
    vec4 r = tex(uv + d); vec4 b = tex(uv - d);
    float a = max(c.a, max(r.a, b.a));
    o = vec4(r.r, c.g, b.b, a);
  } else if (u_type == 4) { // chromatic aberration
    vec2 d = (uv - 0.5) * u_p.x * 0.06;
    vec4 r = tex(uv + d); vec4 b = tex(uv - d);
    o = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  } else if (u_type == 5) { // glitch p.x=amount p.y=speed p.z=blocks p.w=rgb
    float t = floor(u_time * u_p.y);
    float row = floor(topUV().y * u_p.z);
    float r = hash(vec2(row, t));
    float act = step(1.0 - u_p.x * 0.6, r);
    float shift = (hash(vec2(row * 1.7, t + 3.1)) - 0.5) * 0.25 * u_p.x * act;
    float big = step(0.92, hash(vec2(t, 9.0))) * u_p.x;
    vec2 g = uv + vec2(shift + (hash(vec2(t, 2.0)) - 0.5) * 0.05 * big, 0.0);
    float rs = u_p.w * u_p.x * 0.02 * (0.5 + act);
    vec4 cr = tex(g + vec2(rs, 0.0)); vec4 cg = tex(g); vec4 cb = tex(g - vec2(rs, 0.0));
    o = vec4(cr.r, cg.g, cb.b, max(cg.a, max(cr.a, cb.a)));
    float line = step(0.97, hash(vec2(floor(topUV().y * u_res.y / 3.0), t))) * u_p.x;
    o.rgb = mix(o.rgb, vec3(o.a) - o.rgb, line * 0.8);
  } else if (u_type == 6) { // noise p.x=amount p.y=mono p.z=speed
    float t = floor(u_time * max(u_p.z, 0.01));
    vec2 px = floor(uv * u_res);
    vec3 n = u_p.y > 0.5 ? vec3(hash(px + t * 17.0)) : vec3(hash(px + t * 17.0), hash(px + t * 31.0 + 5.0), hash(px + t * 7.0 + 9.0));
    o = vec4(clamp(c.rgb + (n - 0.5) * u_p.x * c.a, 0.0, 1.0), c.a);
  } else if (u_type == 7) { // flash p.x=amount c1=color
    o = vec4(mix(c.rgb, u_c1 * c.a, u_p.x), c.a);
  } else if (u_type == 8) { // ripple p.x=amp px p.y=wavelength px p.z=speed q.xy=center
    vec2 ctr = vec2(u_q.x, 1.0 - u_q.y);
    vec2 d = (uv - ctr) * u_res; float dist = length(d);
    float w = sin(dist / u_p.y * 6.2831 - u_time * u_p.z * 6.2831);
    vec2 off = dist > 0.0 ? d / dist * w * u_p.x : vec2(0.0);
    o = tex(uv + off / u_res);
  } else if (u_type == 9) { // wave p.x=amp p.y=wavelength p.z=speed p.w=vertical
    vec2 px = uv * u_res;
    vec2 off = u_p.w > 0.5 ? vec2(0.0, sin(px.x / u_p.y * 6.2831 + u_time * u_p.z * 6.2831) * u_p.x) : vec2(sin(px.y / u_p.y * 6.2831 + u_time * u_p.z * 6.2831) * u_p.x, 0.0);
    o = tex(uv + off / u_res);
  } else if (u_type == 10) { // gradient overlay: c1,c2, p.x=angle p.y=opacity p.z=mode p.w=radial
    vec2 t = topUV();
    float g;
    if (u_p.w > 0.5) g = clamp(length((t - 0.5) * vec2(asp, 1.0)) * 1.4, 0.0, 1.0);
    else { vec2 dir = vec2(cos(radians(u_p.x)), sin(radians(u_p.x))); g = clamp(dot(t - 0.5, dir) + 0.5, 0.0, 1.0); }
    vec3 gc = mix(u_c1, u_c2, g);
    vec3 base = unpm(c); vec3 r;
    int m = int(u_p.z + 0.5);
    if (m == 0) r = gc; else if (m == 1) r = base * gc; else if (m == 2) r = 1.0 - (1.0 - base) * (1.0 - gc);
    else r = mix(2.0 * base * gc, 1.0 - 2.0 * (1.0 - base) * (1.0 - gc), step(0.5, base));
    o = vec4(mix(base, r, u_p.y) * c.a, c.a);
  } else if (u_type == 11) { // pixelate p.x=size px
    vec2 b = u_p.x / u_res; o = tex((floor(uv / b) + 0.5) * b);
  } else if (u_type == 12) { // mirror p.x: 0=h 1=v 2=quad
    vec2 m = uv;
    if (u_p.x < 0.5 || u_p.x > 1.5) m.x = m.x > 0.5 ? 1.0 - m.x : m.x;
    if (u_p.x > 0.5) m.y = m.y > 0.5 ? 1.0 - m.y : m.y;
    o = tex(m);
  } else if (u_type == 13) { // invert
    o = vec4(mix(c.rgb, vec3(c.a) - c.rgb, u_p.x), c.a);
  } else if (u_type == 14) { // posterize
    vec3 b = unpm(c); b = floor(b * u_p.x) / (u_p.x - 1.0); o = vec4(clamp(b, 0.0, 1.0) * c.a, c.a);
  } else if (u_type == 15) { // sharpen
    vec2 e = 1.0 / u_res;
    vec4 n = tex(uv + vec2(e.x, 0)) + tex(uv - vec2(e.x, 0)) + tex(uv + vec2(0, e.y)) + tex(uv - vec2(0, e.y));
    o = clamp(c + (c * 4.0 - n) * u_p.x * 0.5, 0.0, 1.0); o.rgb = min(o.rgb, vec3(o.a));
  } else if (u_type == 16) { // scanlines p.x amount p.y density
    float l = 0.5 + 0.5 * sin(topUV().y * u_res.y / u_p.y * 3.14159);
    o = vec4(c.rgb * (1.0 - u_p.x * l), c.a);
  } else if (u_type == 17) { // fisheye p.x amount
    vec2 p = (uv - 0.5) * vec2(asp, 1.0);
    float r = length(p);
    vec2 q = p * (1.0 + u_p.x * r * r * 1.2) / (1.0 + u_p.x * 0.3);
    vec2 s = q / vec2(asp, 1.0) + 0.5;
    o = (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) ? vec4(0.0) : tex(s);
  } else if (u_type == 18) { // lens flare: p.xy pos p.z intensity p.w size c1 color
    vec2 t = topUV();
    vec2 pos = u_p.xy;
    vec2 d = (t - pos) * vec2(asp, 1.0);
    float r = length(d);
    float s = u_p.w;
    vec3 col = vec3(0.0);
    col += u_c1 * (0.08 * s / (r + 0.02)) * 0.6;
    col += u_c1 * exp(-r * r / (0.002 * s * s)) * 1.2;
    float streak = exp(-abs(d.y) * 160.0 / s) * exp(-abs(d.x) * 1.8 / s);
    col += mix(u_c1, vec3(0.6, 0.8, 1.0), 0.5) * streak * 0.9;
    vec2 axis = vec2(0.5) - pos;
    for (int i = 1; i <= 5; i++) {
      float k = float(i) * 0.38 - 0.1;
      vec2 gp = pos + axis * (1.0 + k);
      float gr = length((t - gp) * vec2(asp, 1.0));
      float sz = (0.02 + 0.03 * hash1(float(i) * 3.7)) * s;
      vec3 gcol = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.5, 0.3), hash1(float(i)));
      col += gcol * smoothstep(sz, sz * 0.6, gr) * 0.25;
    }
    float ring = exp(-pow((r - 0.35 * s) * 18.0 / s, 2.0)) * 0.12;
    col += vec3(0.6, 0.9, 1.0) * ring;
    col *= u_p.z;
    vec3 rgb = c.rgb + col; float a = max(c.a, min(1.0, max(max(rgb.r, rgb.g), rgb.b)));
    o = vec4(min(rgb, vec3(a)), a);
  } else o = c;
}`;

export const FS_BLEND = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_base; uniform sampler2D u_layer; uniform int u_mode; uniform float u_opacity;
${COMMON}
float od(float b, float s){ return b <= 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s))); }
float cb(float b, float s){ return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s)); }
float sl(float b, float s){
  if (s <= 0.5) return b - (1.0 - 2.0*s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0*b - 12.0)*b + 4.0)*b : sqrt(b);
  return b + (2.0*s - 1.0) * (d - b);
}
vec3 blend(vec3 b, vec3 s){
  if (u_mode == 1) return b * s;
  if (u_mode == 2) return b + s - b * s;
  if (u_mode == 3) return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, b));
  if (u_mode == 4) return min(b + s, vec3(1.0));
  if (u_mode == 5) return min(b, s);
  if (u_mode == 6) return max(b, s);
  if (u_mode == 7) return vec3(sl(b.r,s.r), sl(b.g,s.g), sl(b.b,s.b));
  if (u_mode == 8) return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, s));
  if (u_mode == 9) return abs(b - s);
  if (u_mode == 10) return b + s - 2.0*b*s;
  if (u_mode == 11) return vec3(od(b.r,s.r), od(b.g,s.g), od(b.b,s.b));
  if (u_mode == 12) return vec3(cb(b.r,s.r), cb(b.g,s.g), cb(b.b,s.b));
  return s;
}
void main(){
  vec4 B = texture(u_base, v_uv);
  vec4 S = texture(u_layer, v_uv) * u_opacity;
  if (u_mode == 0) { o = S + B * (1.0 - S.a); return; }
  vec3 Cs = unpm(S); vec3 Cb = unpm(B);
  vec3 mixed = (1.0 - B.a) * Cs + B.a * clamp(blend(Cb, Cs), 0.0, 1.0);
  o = vec4(S.a * mixed + (1.0 - S.a) * B.rgb, S.a + B.a * (1.0 - S.a));
}`;

export const FS_TRANSITION = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_a; uniform sampler2D u_b; uniform float u_p; uniform int u_type; uniform vec2 u_res; uniform float u_time;
${COMMON}
vec4 A(vec2 uv){ return (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) ? vec4(0.0) : texture(u_a, uv); }
vec4 B(vec2 uv){ return (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) ? vec4(0.0) : texture(u_b, uv); }
vec4 blurS(sampler2D t, vec2 uv, float r){
  vec4 s = vec4(0.0); float n = 0.0;
  for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) { s += texture(t, uv + vec2(float(x), float(y)) * r / u_res); n += 1.0; }
  return s / n;
}
void main(){
  vec2 uv = v_uv; float p = clamp(u_p, 0.0, 1.0);
  vec2 t = vec2(uv.x, 1.0 - uv.y);
  float asp = u_res.x / u_res.y;
  vec4 a = A(uv); vec4 b = B(uv);
  float edge = 0.02;
  if (u_type == 0) o = mix(a, b, p);
  else if (u_type == 1 || u_type == 2) { // fade through black/white
    vec3 col = u_type == 1 ? vec3(0.0) : vec3(1.0);
    float k = p < 0.5 ? p * 2.0 : (1.0 - p) * 2.0;
    vec4 src = p < 0.5 ? a : b;
    float al = max(a.a, b.a);
    o = vec4(mix(src.rgb + col * (al - src.a), col * al, k), al);
  }
  else if (u_type == 3) o = mix(a, b, smoothstep(p - edge, p + edge, 1.0 - t.x) );
  else if (u_type == 4) o = mix(a, b, smoothstep(p - edge, p + edge, t.x));
  else if (u_type == 5) o = mix(a, b, smoothstep(p - edge, p + edge, 1.0 - t.y));
  else if (u_type == 6) o = mix(a, b, smoothstep(p - edge, p + edge, t.y));
  else if (u_type == 7) { vec4 aa = A(uv + vec2(p, 0.0)); vec4 bb = B(uv - vec2(1.0 - p, 0.0)); o = bb + aa * (1.0 - bb.a); }
  else if (u_type == 8) { vec4 aa = A(uv - vec2(p, 0.0)); vec4 bb = B(uv + vec2(1.0 - p, 0.0)); o = bb + aa * (1.0 - bb.a); }
  else if (u_type == 9) { vec4 aa = A(uv - vec2(0.0, p)); vec4 bb = B(uv + vec2(0.0, 1.0 - p)); o = bb + aa * (1.0 - bb.a); }
  else if (u_type == 10) { vec4 aa = A(uv + vec2(0.0, p)); vec4 bb = B(uv - vec2(0.0, 1.0 - p)); o = bb + aa * (1.0 - bb.a); }
  else if (u_type == 11) { // zoom in
    vec4 aa = A((uv - 0.5) / (1.0 + p * 1.5) + 0.5); vec4 bb = B((uv - 0.5) * (1.0 + (1.0 - p) * 0.6) + 0.5);
    o = mix(aa, bb, smoothstep(0.3, 0.7, p));
  } else if (u_type == 12) { // zoom out
    vec4 aa = A((uv - 0.5) * (1.0 + p * 1.5) + 0.5); vec4 bb = B((uv - 0.5) / (1.0 + (1.0 - p) * 0.6) + 0.5);
    o = mix(aa, bb, smoothstep(0.3, 0.7, p));
  } else if (u_type == 13) { // circle reveal
    float r = length((t - 0.5) * vec2(asp, 1.0)); float R = p * length(vec2(asp, 1.0)) * 0.5 * 1.05;
    o = mix(a, b, 1.0 - smoothstep(R - 0.01, R + 0.01, r));
  } else if (u_type == 14) { // blur dissolve
    float r = sin(p * 3.14159) * 18.0;
    o = mix(blurS(u_a, uv, r), blurS(u_b, uv, r), smoothstep(0.35, 0.65, p));
  } else if (u_type == 15) { // glitch
    float tt = floor(p * 24.0);
    float row = floor(t.y * 18.0);
    float sh = (hash(vec2(row, tt)) - 0.5) * 0.3 * sin(p * 3.14159);
    vec2 g = uv + vec2(sh, 0.0);
    vec4 src = hash(vec2(row + 4.0, tt)) < p ? B(g) : A(g);
    float rs = 0.02 * sin(p * 3.14159);
    o = vec4(hash(vec2(row, tt+1.0)) < p ? B(g + vec2(rs,0)).r : A(g + vec2(rs,0)).r, src.g, hash(vec2(row, tt+2.0)) < p ? B(g - vec2(rs,0)).b : A(g - vec2(rs,0)).b, src.a);
  } else if (u_type == 16) { // flash
    vec4 m = mix(a, b, smoothstep(0.45, 0.55, p));
    float f = exp(-pow((p - 0.5) * 7.0, 2.0));
    float al = max(m.a, f);
    o = vec4(mix(m.rgb, vec3(al), f), al);
  } else if (u_type == 17) { // spin
    float ang = (p < 0.5 ? p : p - 1.0) * 6.2831 * 0.5;
    float sc = 1.0 + sin(p * 3.14159) * 1.2;
    vec2 q = (uv - 0.5) * vec2(asp, 1.0);
    q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q * sc;
    vec2 r2 = q / vec2(asp, 1.0) + 0.5;
    o = p < 0.5 ? A(r2) : B(r2);
  } else if (u_type == 18) { // pixelize
    float s = max(1.0, sin(p * 3.14159) * 60.0);
    vec2 bl = s / u_res; vec2 q = (floor(uv / bl) + 0.5) * bl;
    o = p < 0.5 ? A(q) : B(q);
  } else o = mix(a, b, p);
}`;
