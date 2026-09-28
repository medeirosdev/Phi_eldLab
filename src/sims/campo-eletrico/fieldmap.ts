import type { Camera } from '../../core/camera';
import { Program, RECT_VS, unitQuad } from '../../core/render/gl';
import { K, SOFT, type Charge } from './physics';

export const MAX_CHARGES = 48;

/**
 * Mapa de potencial / |E| calculado por pixel na GPU, com equipotenciais
 * anti-serrilhadas (espaçamento ΔV uniforme, via derivadas de tela).
 */
const FS = `#version 300 es
precision highp float;
uniform vec3 uQ[${MAX_CHARGES}];  // x, y (m), k·q (V·m)
uniform int uN;
uniform vec4 uCam;                // cx, cy, zoom (px/m), dpr
uniform vec2 uRes;                // tamanho em px CSS
uniform int uMode;                // 0 potencial, 1 |E|, 2 nenhum
uniform float uDV;
uniform float uVs;
uniform float uEs;
uniform float uSoft2;
uniform bool uLines;
out vec4 o;

vec3 magma(float t) {
  vec3 c0 = vec3(0.02, 0.03, 0.07), c1 = vec3(0.24, 0.07, 0.40), c2 = vec3(0.78, 0.22, 0.42), c3 = vec3(1.0, 0.6, 0.35), c4 = vec3(1.0, 0.95, 0.78);
  if (t < 0.3) return mix(c0, c1, t / 0.3);
  if (t < 0.6) return mix(c1, c2, (t - 0.3) / 0.3);
  if (t < 0.85) return mix(c2, c3, (t - 0.6) / 0.25);
  return mix(c3, c4, (t - 0.85) / 0.15);
}

void main() {
  vec2 s = vec2(gl_FragCoord.x, uRes.y * uCam.w - gl_FragCoord.y) / uCam.w;
  vec2 w = vec2((s.x - uRes.x * 0.5) / uCam.z + uCam.x, uCam.y - (s.y - uRes.y * 0.5) / uCam.z);
  float V = 0.0;
  vec2 E = vec2(0.0);
  for (int i = 0; i < ${MAX_CHARGES}; i++) {
    if (i >= uN) break;
    vec2 d = w - uQ[i].xy;
    float r2 = dot(d, d) + uSoft2;
    float r = sqrt(r2);
    V += uQ[i].z / r;
    E += uQ[i].z * d / (r2 * r);
  }

  vec3 bg = vec3(0.027, 0.035, 0.06);
  vec3 col = bg;
  if (uMode == 0) {
    float t = tanh(V / uVs);
    vec3 pos = mix(vec3(0.55, 0.12, 0.18), vec3(1.0, 0.55, 0.35), clamp(abs(t) * 1.3 - 0.3, 0.0, 1.0));
    vec3 neg = mix(vec3(0.10, 0.22, 0.60), vec3(0.45, 0.75, 1.0), clamp(abs(t) * 1.3 - 0.3, 0.0, 1.0));
    col = mix(bg, t > 0.0 ? pos : neg, pow(abs(t), 0.8) * 0.85);
  } else if (uMode == 1) {
    float m = log(length(E) / uEs + 1e-6) / log(10.0);
    col = magma(clamp((m + 1.6) / 2.6, 0.0, 1.0)) * 0.9;
  }

  if (uLines) {
    float wv = V / uDV;
    float fw = fwidth(wv);
    float dist = abs(fract(wv + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.5 * fw, 1.5 * fw, dist);
    float fade = 1.0 - smoothstep(0.12, 0.4, fw);
    bool zero = abs(wv) < 0.5;
    col = mix(col, zero ? vec3(1.0) : vec3(0.92, 0.95, 1.0), line * fade * (zero ? 0.4 : 0.26));
  }
  o = vec4(col, 1.0);
}`;

export class FieldMap {
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private q = new Float32Array(MAX_CHARGES * 3);

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = new Program(gl, RECT_VS, FS);
    this.vao = unitQuad(gl);
  }

  render(charges: Charge[], cam: Camera, dpr: number, mode: number, dV: number, vS: number, eS: number, lines: boolean) {
    const gl = this.gl;
    const n = Math.min(MAX_CHARGES, charges.length);
    for (let i = 0; i < n; i++) {
      const c = charges[i];
      this.q[i * 3] = c.x;
      this.q[i * 3 + 1] = c.y;
      this.q[i * 3 + 2] = K * c.q;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    const p = this.prog.use();
    gl.uniform3fv(p.u('uQ'), this.q);
    gl.uniform1i(p.u('uN'), n);
    gl.uniform4f(p.u('uCam'), cam.x, cam.y, cam.zoom, dpr);
    gl.uniform2f(p.u('uRes'), cam.w, cam.h);
    gl.uniform1i(p.u('uMode'), mode);
    gl.uniform1f(p.u('uDV'), dV);
    gl.uniform1f(p.u('uVs'), vS);
    gl.uniform1f(p.u('uEs'), eS);
    gl.uniform1f(p.u('uSoft2'), SOFT * SOFT);
    gl.uniform1i(p.u('uLines'), lines ? 1 : 0);
    gl.uniform4f(p.u('uRect'), -1, -1, 1, 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose() {
    this.prog.dispose();
    this.gl.deleteVertexArray(this.vao);
  }
}
