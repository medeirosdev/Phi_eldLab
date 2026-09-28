import { Program, RECT_VS, floatTarget, unitQuad, type Target } from '../../core/render/gl';

export const MAX_SOURCES = 8;

/**
 * Equação de onda 2D amortecida, ∂²u/∂t² = c²(x)∇²u − γ(x)∂u/∂t + s(x,t),
 * por diferenças finitas centradas (leapfrog), inteiramente na GPU.
 *
 * Estado (RGBA32F):  R = uⁿ,  G = uⁿ⁻¹,  B = ⟨u²⟩ (média móvel → intensidade).
 * Meio   (RGBA8):    R = meio denso (índice n),  G = parede,  B = camada absorvente.
 */
const STEP_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uMed;
uniform ivec2 uSize;
uniform float uC2;       // (c·Δt/Δx)² no meio livre
uniform float uInvN2;    // 1/n² no meio denso
uniform float uGmax;     // γΔt/2 máximo na camada absorvente
uniform float uAlpha;    // peso da média móvel de u²
uniform vec4 uSeg[${MAX_SOURCES}];   // fonte = segmento (a → b), em células; ponto: a = b
uniform float uAmp[${MAX_SOURCES}];
uniform int uNSrc;
uniform float uSrcW;
out vec4 o;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  vec4 m = texelFetch(uMed, p, 0);
  if (m.g > 0.5 || p.x == 0 || p.y == 0 || p.x == uSize.x - 1 || p.y == uSize.y - 1) {
    o = vec4(0.0, 0.0, s.b * (1.0 - uAlpha), 1.0);
    return;
  }
  float lap = texelFetch(uState, p + ivec2(1, 0), 0).r + texelFetch(uState, p - ivec2(1, 0), 0).r
            + texelFetch(uState, p + ivec2(0, 1), 0).r + texelFetch(uState, p - ivec2(0, 1), 0).r
            - 4.0 * s.r;
  float c2 = uC2 * mix(1.0, uInvN2, m.r);
  float g = m.b * uGmax;

  vec2 x = vec2(p) + 0.5;
  float f = 0.0;
  for (int i = 0; i < ${MAX_SOURCES}; i++) {
    if (i >= uNSrc) break;
    vec2 a = uSeg[i].xy, ab = uSeg[i].zw - a;
    float L2 = dot(ab, ab);
    float t = L2 > 0.0 ? clamp(dot(x - a, ab) / L2, 0.0, 1.0) : 0.0;
    vec2 d = x - a - ab * t;
    f += uAmp[i] * exp(-dot(d, d) / (uSrcW * uSrcW));
  }

  float un = (2.0 * s.r - (1.0 - g) * s.g + c2 * lap + f) / (1.0 + g);
  o = vec4(un, s.r, mix(s.b, un * un, uAlpha), 1.0);
}`;

const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uMed;
uniform ivec2 uSize;
uniform int uMode;       // 0 superfície, 1 amplitude, 2 intensidade
uniform float uGain;
in vec2 vUv;
out vec4 o;

// amostragem bilinear manual (texturas float nem sempre são filtráveis)
vec4 st(vec2 uv) {
  vec2 q = uv * vec2(uSize) - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  ivec2 mx = uSize - 1;
  vec4 a = texelFetch(uState, clamp(i, ivec2(0), mx), 0);
  vec4 b = texelFetch(uState, clamp(i + ivec2(1, 0), ivec2(0), mx), 0);
  vec4 c = texelFetch(uState, clamp(i + ivec2(0, 1), ivec2(0), mx), 0);
  vec4 d = texelFetch(uState, clamp(i + ivec2(1, 1), ivec2(0), mx), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 magma(float t) {
  vec3 c0 = vec3(0.02, 0.03, 0.07), c1 = vec3(0.30, 0.08, 0.42), c2 = vec3(0.86, 0.26, 0.36), c3 = vec3(1.0, 0.72, 0.38), c4 = vec3(1.0, 0.97, 0.82);
  if (t < 0.3) return mix(c0, c1, t / 0.3);
  if (t < 0.6) return mix(c1, c2, (t - 0.3) / 0.3);
  if (t < 0.85) return mix(c2, c3, (t - 0.6) / 0.25);
  return mix(c3, c4, (t - 0.85) / 0.15);
}

void main() {
  vec2 tx = 1.0 / vec2(uSize);
  vec4 s = st(vUv);
  vec4 m = texture(uMed, vUv);
  float u = s.r * uGain;
  vec3 col;
  if (uMode == 0) {
    float k = 2.2 * uGain;
    float dx = (st(vUv + vec2(tx.x, 0.0)).r - st(vUv - vec2(tx.x, 0.0)).r) * k;
    float dy = (st(vUv + vec2(0.0, tx.y)).r - st(vUv - vec2(0.0, tx.y)).r) * k;
    vec3 n = normalize(vec3(-dx, -dy, 1.0));
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
    vec3 deep = vec3(0.015, 0.06, 0.09), shallow = vec3(0.06, 0.36, 0.40);
    col = mix(deep, shallow, 0.5 + 0.5 * tanh(u)) * (0.45 + 0.75 * diff);
    col += spec * vec3(0.75, 0.95, 1.0) * 0.55;
    col += vec3(0.24, 0.9, 0.77) * pow(max(tanh(u), 0.0), 2.0) * 0.28;
  } else if (uMode == 1) {
    float v = tanh(u);
    vec3 bg = vec3(0.02, 0.03, 0.06);
    col = v > 0.0 ? mix(bg, vec3(0.24, 0.9, 0.77), v) + vec3(0.6) * pow(v, 4.0)
                  : mix(bg, vec3(0.38, 0.32, 0.98), -v);
  } else {
    float A = sqrt(2.0 * max(s.b, 0.0)) * uGain;
    col = magma(tanh(A * 1.1));
  }
  // vidro (meio denso)
  float gl = smoothstep(0.3, 0.7, m.r);
  col = mix(col, col * vec3(0.8, 0.88, 1.25) + vec3(0.05, 0.04, 0.12), gl * 0.85);
  col += vec3(0.5, 0.45, 1.0) * gl * (1.0 - gl) * 1.2;
  // camada absorvente ("praia")
  col *= 1.0 - 0.45 * m.b;
  // paredes
  float w = smoothstep(0.3, 0.7, m.g);
  vec3 wall = vec3(0.17, 0.2, 0.28) + vec3(0.45, 0.5, 0.6) * w * (1.0 - w) * 2.5;
  col = mix(col, wall, w);
  o = vec4(col, 1.0);
}`;

export interface SourceSeg {
  /** Em células: a = (ax, ay), b = (bx, by). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  amp: number;
}

export class WaveSolver {
  readonly medData: Uint8Array;
  medDirty = true;

  private step: Program;
  private show: Program;
  private vao: WebGLVertexArrayObject;
  private tg: Target[];
  private cur = 0;
  private med: WebGLTexture;
  private seg = new Float32Array(MAX_SOURCES * 4);
  private amp = new Float32Array(MAX_SOURCES);

  constructor(private gl: WebGL2RenderingContext, readonly W: number, readonly H: number) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float indisponível');
    this.step = new Program(gl, RECT_VS, STEP_FS);
    this.show = new Program(gl, RECT_VS, SHOW_FS);
    this.vao = unitQuad(gl);
    this.tg = [floatTarget(gl, W, H), floatTarget(gl, W, H)];
    this.medData = new Uint8Array(W * H * 4);
    this.med = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.med);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.medData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uploadMedium() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.med);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, this.medData);
    this.medDirty = false;
  }

  private bindInputs(p: Program) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tg[this.cur].tex);
    gl.uniform1i(p.u('uState'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.med);
    gl.uniform1i(p.u('uMed'), 1);
    gl.uniform2i(p.u('uSize'), this.W, this.H);
  }

  advance(o: { c2: number; invN2: number; gmax: number; alpha: number; srcW: number; sources: SourceSeg[] }) {
    const gl = this.gl;
    if (this.medDirty) this.uploadMedium();
    const n = Math.min(MAX_SOURCES, o.sources.length);
    for (let i = 0; i < n; i++) {
      const s = o.sources[i];
      this.seg.set([s.ax, s.ay, s.bx, s.by], i * 4);
      this.amp[i] = s.amp;
    }
    const next = 1 - this.cur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tg[next].fbo);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    const p = this.step.use();
    this.bindInputs(p);
    gl.uniform1f(p.u('uC2'), o.c2);
    gl.uniform1f(p.u('uInvN2'), o.invN2);
    gl.uniform1f(p.u('uGmax'), o.gmax);
    gl.uniform1f(p.u('uAlpha'), o.alpha);
    gl.uniform1f(p.u('uSrcW'), o.srcW);
    gl.uniform1i(p.u('uNSrc'), n);
    gl.uniform4fv(p.u('uSeg'), this.seg);
    gl.uniform1fv(p.u('uAmp'), this.amp);
    gl.uniform4f(p.u('uRect'), -1, -1, 1, 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.cur = next;
  }

  /** Desenha o tanque no retângulo (NDC) dado. */
  render(rect: [number, number, number, number], mode: number, gain: number) {
    const gl = this.gl;
    if (this.medDirty) this.uploadMedium();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const p = this.show.use();
    this.bindInputs(p);
    gl.uniform1i(p.u('uMode'), mode);
    gl.uniform1f(p.u('uGain'), gain);
    gl.uniform4f(p.u('uRect'), rect[0], rect[1], rect[2], rect[3]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Lê uma coluna do estado (4 floats por célula). */
  readColumn(ix: number, out: Float32Array) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tg[this.cur].fbo);
    gl.readPixels(ix, 0, 1, this.H, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  readCell(ix: number, iy: number, out: Float32Array) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tg[this.cur].fbo);
    gl.readPixels(ix, iy, 1, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  clearWaves() {
    const gl = this.gl;
    for (const t of this.tg) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    const gl = this.gl;
    this.step.dispose();
    this.show.dispose();
    for (const t of this.tg) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    gl.deleteTexture(this.med);
    gl.deleteVertexArray(this.vao);
  }
}
