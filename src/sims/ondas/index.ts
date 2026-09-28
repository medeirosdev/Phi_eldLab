import type {
  ChartDef, ParamDef, ParamValue, PointerInfo, ReadoutDef, SimContext, Simulation, ToolDef,
} from '../../core/types';
import { arrow, label } from '../../core/render/draw';
import { glowSprite, rgba, type RGB } from '../../core/render/glow';
import { niceStep, num, sig } from '../../core/units';
import { icons } from '../../ui/icons';
import {
  DX, LENS, LX, LY, NX, NY, PARABOLA, PRESETS, SNELL, buildScene, type Mode, type Source, type Theory,
} from './presets';
import { MAX_SOURCES, WaveSolver, type SourceSeg } from './solver';

const TEAL: RGB = [62, 230, 196];
const WARM: RGB = [255, 184, 107];
/** Velocidade máxima permitida (cm/s): fixa o passo pela condição CFL, c·Δt/Δx ≤ 1/√2. */
const CMAX = 40;
const DT = (0.5 * DX) / CMAX;
const SPONGE = 20;
const GMAX = 0.25;
const TAU_I = 0.3;
const G_CM = 981;
const MODES: Mode[] = ['superficie', 'amplitude', 'intensidade'];
const LABEL_FONT = '500 11px Inter, system-ui, sans-serif';
const MONO_FONT = '500 11px "JetBrains Mono", ui-monospace, monospace';

type Drag =
  | { kind: 'src'; idx: number }
  | { kind: 'paint'; lx: number; ly: number }
  | { kind: 'probe' }
  | { kind: 'ruler' };

export default class Ondas implements Simulation {
  readonly presets = PRESETS;
  readonly time = { dt: DT, scale: 1 };
  readonly hint =
    'Use as <b>ferramentas</b> à esquerda: crie fontes, desenhe paredes e vidro, posicione a sonda ou meça com a régua · roda = zoom · <kbd>1</kbd>–<kbd>6</kbd> trocam de ferramenta';
  currentPreset = 'duas-fontes';
  tool = 'fonte';

  readonly tools: ToolDef[] = [
    { id: 'fonte', label: 'Fonte', icon: icons.source, hint: 'Clique para criar uma fonte; arraste uma fonte para movê-la' },
    { id: 'parede', label: 'Parede', icon: icons.wall, hint: 'Arraste para desenhar paredes refletoras' },
    { id: 'vidro', label: 'Meio lento (vidro)', icon: icons.glass, hint: 'Pinte um meio de índice n, onde a onda anda mais devagar' },
    { id: 'apagar', label: 'Apagar', icon: icons.eraser, hint: 'Arraste para apagar paredes e vidro; clique numa fonte para removê-la' },
    { id: 'sonda', label: 'Sonda', icon: icons.probe, hint: 'Clique para medir a amplitude num ponto' },
    { id: 'regua', label: 'Régua', icon: icons.ruler, hint: 'Arraste para medir: cada marca é um comprimento de onda' },
  ];

  private app!: SimContext;
  private solver: WaveSolver | null = null;
  private t = 0;
  private sources: Source[] = [];
  private segs: SourceSeg[] = [];
  private movX0 = 4;
  private movT0 = 0;
  private walls?: (x: number, y: number) => boolean;
  private glass?: (x: number, y: number) => boolean;
  private probe: [number, number] | null = null;
  private ruler: [number, number, number, number] | null = null;
  private screen: number | null = null;
  private theory?: Theory;
  private profile = new Float32Array(NY);
  private hasProfile = false;
  private col = new Float32Array(NY * 4);
  private cellBuf = new Float32Array(4);
  private probeAmp = 0;
  private frameN = 0;
  private drag: Drag | null = null;

  private P = {
    f: 10, A: 1, phase: 0, vs: 0.6, c: 25, n: 1.5, absorb: true,
    mode: 'superficie' as Mode, gain: 0, profile: false, screenX: 36,
  };

  readonly params: ParamDef[] = [
    { type: 'range', key: 'f', label: 'Frequência', group: 'Fontes', min: 2, max: 25, step: 0.5, value: 10, format: (v) => `${num(v, 1)} Hz` },
    { type: 'range', key: 'A', label: 'Amplitude', group: 'Fontes', min: 0.2, max: 2, step: 0.05, value: 1, format: (v) => `${num(v, 2)}` },
    {
      type: 'range', key: 'phase', label: 'Defasagem entre fontes', group: 'Fontes', min: 0, max: 360, step: 5, value: 0,
      format: (v) => `${num(v, 0)}°`, hint: 'Fase das demais fontes em relação à primeira. 180° troca máximos por mínimos.',
    },
    {
      type: 'range', key: 'vs', label: 'Velocidade da fonte móvel', group: 'Fontes', min: 0, max: 1.6, step: 0.05, value: 0.6,
      format: (v) => `${num(v, 2)} c`, hint: 'Fração da velocidade da onda (número de Mach). Só afeta fontes móveis (cenário Doppler).',
    },
    {
      type: 'range', key: 'c', label: 'Velocidade da onda c', group: 'Meio', min: 10, max: CMAX, step: 1, value: 25,
      format: (v) => `${num(v, 0)} cm/s`, hint: 'Em água rasa, c = √(g·h): mais fundo, mais rápido.',
    },
    {
      type: 'range', key: 'n', label: 'Índice do vidro n', group: 'Meio', min: 1, max: 2.5, step: 0.05, value: 1.5,
      format: (v) => num(v, 2), hint: 'No meio denso a onda anda a c/n.',
    },
    {
      type: 'toggle', key: 'absorb', label: 'Bordas absorventes', group: 'Meio', value: true,
      hint: 'Desligue para as ondas refletirem nas bordas do tanque.',
    },
    { type: 'action', key: 'limpar', label: 'Limpar paredes e vidro', group: 'Meio' },
    { type: 'action', key: 'zerar', label: 'Acalmar a água', group: 'Meio' },
    {
      type: 'select', key: 'mode', label: 'Modo', group: 'Visualização', value: 'superficie',
      options: [
        { value: 'superficie', label: 'Superfície' },
        { value: 'amplitude', label: 'Amplitude' },
        { value: 'intensidade', label: 'Intensidade' },
      ],
    },
    {
      type: 'range', key: 'gain', label: 'Ganho', group: 'Visualização', min: -1, max: 1, step: 0.05, value: 0,
      format: (v) => `×${sig(10 ** v, 2)}`,
    },
    { type: 'toggle', key: 'profile', label: 'Tela com perfil de intensidade', group: 'Visualização', value: false },
    {
      type: 'range', key: 'screenX', label: 'Posição da tela', group: 'Visualização', min: 5, max: 38, step: 0.5, value: 36,
      format: (v) => `${num(v, 1)} cm`,
    },
  ];

  private lambda() {
    return this.P.c / this.P.f;
  }

  private exp(id: string) {
    return () => this.currentPreset === id;
  }

  readonly readouts: ReadoutDef[] = [
    { key: 'f', group: 'Onda', label: 'Frequência f', get: () => `${num(this.P.f, 1)} Hz` },
    { key: 'T', group: 'Onda', label: 'Período T = 1/f', get: () => `${num(1000 / this.P.f, 1)} ms` },
    { key: 'c', group: 'Onda', label: 'Velocidade c', get: () => `${num(this.P.c, 1)} cm/s` },
    { key: 'lambda', group: 'Onda', label: 'Comprimento λ = c/f', get: () => `${num(this.lambda(), 2)} cm` },
    {
      key: 'h', group: 'Onda', label: 'Profundidade equivalente',
      hint: 'Ondas em água rasa: c = √(g·h) ⇒ h = c²/g.',
      get: () => `${num(((this.P.c * this.P.c) / G_CM) * 10, 1)} mm`,
    },

    { key: 'd2', group: 'Experimento', label: 'Separação d', visible: this.exp('duas-fontes'), get: () => '5,00 cm' },
    {
      key: 'nodal', group: 'Experimento', label: 'Linhas nodais', visible: this.exp('duas-fontes'),
      hint: 'Mínimos onde d·sen θ = (m + ½)λ. Existem 2·⌊d/λ + ½⌋ linhas.',
      get: () => `${2 * Math.floor(5 / this.lambda() + 0.5)}`,
    },
    { key: 'yd', group: 'Experimento', label: 'Separação das fendas d', visible: this.exp('young'), get: () => `${num(this.theory?.d ?? 0, 2)} cm` },
    { key: 'yL', group: 'Experimento', label: 'Distância à tela L', visible: this.exp('young'), get: () => `${num(this.screenL(), 2)} cm` },
    {
      key: 'ydy', group: 'Experimento', label: 'Franjas Δy = λL/d', visible: this.exp('young'),
      hint: 'Espaçamento previsto entre franjas claras (aproximação de ângulos pequenos).',
      get: () => `${num((this.lambda() * this.screenL()) / (this.theory?.d ?? 1), 2)} cm`,
    },
    { key: 'sa', group: 'Experimento', label: 'Largura da fenda a', visible: this.exp('fenda'), get: () => `${num(this.theory?.a ?? 0, 2)} cm` },
    {
      key: 'sth', group: 'Experimento', label: '1º mínimo: sen θ = λ/a', visible: this.exp('fenda'),
      get: () => {
        const s = this.lambda() / (this.theory?.a ?? 1);
        return s < 1 ? `θ = ${num((Math.asin(s) * 180) / Math.PI, 1)}°` : 'sem mínimos (λ > a)';
      },
    },
    {
      key: 'lf', group: 'Experimento', label: 'Foco f = R/2(n−1)', visible: this.exp('lente'),
      hint: 'Equação do fabricante de lentes, para lente fina biconvexa simétrica.',
      get: () => (this.P.n > 1 ? `${num(this.lensF(), 1)} cm` : '∞'),
    },
    { key: 'ln', group: 'Experimento', label: 'λ no vidro = λ/n', visible: () => this.currentPreset === 'lente' || this.currentPreset === 'snell', get: () => `${num(this.lambda() / this.P.n, 2)} cm` },
    { key: 'st1', group: 'Experimento', label: 'Incidência θ₁', visible: this.exp('snell'), get: () => `${SNELL.angle}°` },
    {
      key: 'st2', group: 'Experimento', label: 'Refração θ₂ (Snell)', visible: this.exp('snell'),
      get: () => `${num(this.snellTheta2(), 1)}°`,
    },
    { key: 'pf', group: 'Experimento', label: 'Distância focal', visible: this.exp('parabola'), get: () => `${num(PARABOLA.F, 1)} cm` },
    { key: 'dm', group: 'Experimento', label: 'Número de Mach v/c', visible: this.exp('doppler'), get: () => num(this.P.vs, 2) },
    {
      key: 'dff', group: 'Experimento', label: 'f à frente = f/(1 − v/c)', visible: () => this.currentPreset === 'doppler' && this.P.vs < 1,
      get: () => `${num(this.P.f / (1 - this.P.vs), 1)} Hz`,
    },
    {
      key: 'dfb', group: 'Experimento', label: 'f atrás = f/(1 + v/c)', visible: this.exp('doppler'),
      get: () => `${num(this.P.f / (1 + this.P.vs), 1)} Hz`,
    },
    {
      key: 'dcone', group: 'Experimento', label: 'Cone: sen μ = c/v', visible: () => this.currentPreset === 'doppler' && this.P.vs > 1,
      get: () => `μ = ${num((Math.asin(1 / this.P.vs) * 180) / Math.PI, 1)}°`,
    },

    {
      key: 'pa', group: 'Sonda', label: 'Amplitude local', visible: () => !!this.probe,
      hint: 'Amplitude média (√2 · valor RMS) no ponto da sonda, em unidades arbitrárias.',
      get: () => num(this.probeAmp, 3),
    },
    {
      key: 'rl', group: 'Régua', label: 'Comprimento', visible: () => !!this.ruler,
      get: () => `${num(this.rulerLen(), 2)} cm = ${num(this.rulerLen() / this.lambda(), 2)} λ`,
    },
  ];

  readonly charts: ChartDef[] = [
    {
      title: 'Amplitude na sonda',
      format: (v) => num(v, 3),
      series: [{ label: 'Amplitude local', color: '#3ee6c4', get: () => this.probeAmp }],
    },
  ];

  private screenL() {
    return (this.screen ?? this.P.screenX) - (this.theory?.slitX ?? 0);
  }

  private lensF() {
    return LENS.R / (2 * (this.P.n - 1));
  }

  private snellTheta2() {
    return (Math.asin(Math.sin((SNELL.angle * Math.PI) / 180) / this.P.n) * 180) / Math.PI;
  }

  private rulerLen() {
    const r = this.ruler!;
    return Math.hypot(r[2] - r[0], r[3] - r[1]);
  }

  // ───────────────────────── ciclo de vida ─────────────────────────

  init(ctx: SimContext) {
    this.app = ctx;
    ctx.stage.drawBackground = (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 1.6);
      gr.addColorStop(0, '#0a1119');
      gr.addColorStop(1, '#04060a');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    };
    ctx.stage.paintBackground();
    const gl = ctx.stage.enableGL();
    try {
      if (!gl) throw new Error('WebGL2 indisponível');
      this.solver = new WaveSolver(gl, NX, NY);
    } catch (e) {
      console.warn(e);
      this.solver = null;
    }
    ctx.stage.onResize(() => this.fit());
    this.loadPreset(this.currentPreset);
  }

  dispose() {
    this.solver?.dispose();
    this.solver = null;
    this.app.stage.drawBackground = null;
  }

  onTool(id: string) {
    this.tool = id;
  }

  private fit() {
    const { w, h } = this.app.stage;
    const half = Math.max(LY / 2, ((LX / 2) * h) / w) * 1.1;
    this.app.camera.fit(LX / 2, LY / 2, half, true);
  }

  private setParam(key: string, value: ParamValue) {
    (this.P as Record<string, ParamValue>)[key] = value;
    const def = this.params.find((p) => p.key === key);
    if (def && def.type !== 'action') def.value = value as never;
  }

  loadPreset(id: string) {
    const sc = buildScene(id);
    this.currentPreset = id;
    this.setParam('f', sc.f);
    this.setParam('c', sc.c);
    this.setParam('n', sc.n);
    this.setParam('vs', sc.vs);
    this.setParam('mode', sc.mode);
    this.setParam('phase', 0);
    this.setParam('gain', 0);
    this.setParam('profile', sc.screen !== null);
    if (sc.screen !== null) this.setParam('screenX', sc.screen);
    this.screen = sc.screen;
    this.sources = sc.sources.map((s) => ({ ...s }));
    this.movX0 = this.sources.find((s) => s.moving)?.x ?? 4;
    this.movT0 = 0;
    this.walls = sc.walls;
    this.glass = sc.glass;
    this.probe = sc.probe;
    this.theory = sc.theory;
    this.ruler = null;
    this.hasProfile = false;
    this.t = 0;
    this.probeAmp = 0;
    this.buildMedium();
    this.solver?.clearWaves();
    this.fit();
    this.app.resetCharts();
    this.app.refreshUI();
    if (!this.solver) this.app.toast('Este navegador não suporta WebGL2 com texturas de ponto flutuante');
  }

  private buildMedium() {
    const s = this.solver;
    if (!s) return;
    const d = s.medData;
    for (let j = 0; j < NY; j++) {
      const y = (j + 0.5) * DX;
      for (let i = 0; i < NX; i++) {
        const x = (i + 0.5) * DX;
        const o = (j * NX + i) * 4;
        d[o] = this.glass?.(x, y) ? 255 : 0;
        d[o + 1] = this.walls?.(x, y) ? 255 : 0;
        d[o + 3] = 255;
      }
    }
    this.buildSponge();
  }

  /** Camada absorvente: amortecimento que cresce quadraticamente até a borda. */
  private buildSponge() {
    const s = this.solver;
    if (!s) return;
    const d = s.medData;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const e = Math.min(i, j, NX - 1 - i, NY - 1 - j);
        d[(j * NX + i) * 4 + 2] = this.P.absorb && e < SPONGE ? Math.round(255 * ((SPONGE - e) / SPONGE) ** 2) : 0;
      }
    }
    s.medDirty = true;
  }

  onParam(key: string, value: ParamValue) {
    if (key === 'limpar') {
      this.walls = undefined;
      this.glass = undefined;
      const s = this.solver;
      if (s) {
        for (let k = 0; k < NX * NY; k++) s.medData[k * 4] = s.medData[k * 4 + 1] = 0;
        s.medDirty = true;
      }
      return;
    }
    if (key === 'zerar') {
      this.solver?.clearWaves();
      this.hasProfile = false;
      return;
    }
    (this.P as Record<string, ParamValue>)[key] = value;
    if (key === 'absorb') this.buildSponge();
    if (key === 'profile' || key === 'screenX') {
      this.screen = this.P.profile ? this.P.screenX : null;
      this.hasProfile = false;
    }
  }

  // ───────────────────────── física ─────────────────────────

  step(dt: number) {
    const s = this.solver;
    this.t += dt;
    if (!s) return;
    const P = this.P;
    const w = 2 * Math.PI * P.f;
    // amplitudes calibradas para não variar com f e c (ver leis de escala do esquema numérico)
    const kp = P.A * 0.19 * (P.c / 25) ** 1.25 * (P.f / 10) ** 0.55;
    const kl = ((P.A * 0.8) / 62) * (P.c / 25) ** 0.9 * (P.f / 10) ** 0.85;
    this.segs.length = 0;
    this.sources.forEach((src, i) => {
      if (src.moving) {
        let x = this.movX0 + P.vs * P.c * (this.t - this.movT0);
        if (x > LX - 2.5) {
          this.movT0 = this.t;
          x = this.movX0;
        }
        src.x = src.x2 = x;
      }
      const ph = i > 0 ? (P.phase * Math.PI) / 180 : 0;
      this.segs.push({
        ax: src.x / DX, ay: src.y / DX, bx: src.x2 / DX, by: src.y2 / DX,
        amp: (src.line ? kl : kp) * Math.sin(w * this.t + ph),
      });
    });
    s.advance({
      c2: (P.c * DT / DX) ** 2,
      invN2: 1 / (P.n * P.n),
      gmax: GMAX,
      alpha: DT / TAU_I,
      srcW: 1.5,
      sources: this.segs,
    });
  }

  clock() {
    return `t = ${num(this.t, 2)} s`;
  }

  speedLabel(mult: number) {
    return mult === 1 ? 'tempo real' : `${sig(mult, 2)}× tempo real`;
  }

  // ───────────────────────── interação ─────────────────────────

  private inTank(x: number, y: number) {
    return x >= 0 && y >= 0 && x <= LX && y <= LY;
  }

  private hitSource(sx: number, sy: number): number {
    const cam = this.app.camera;
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const s = this.sources[i];
      if (s.line) {
        if (Math.abs(cam.sx(s.x) - sx) < 10) return i;
      } else if (Math.hypot(cam.sx(s.x) - sx, cam.sy(s.y) - sy) < 14) {
        return i;
      }
    }
    return -1;
  }

  private paint(x0: number, y0: number, x1: number, y1: number) {
    const s = this.solver;
    if (!s) return;
    const r = this.tool === 'parede' ? 0.3 : 0.9;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / (r * 0.5)));
    const d = s.medData;
    for (let k = 0; k <= n; k++) {
      const cx = x0 + ((x1 - x0) * k) / n, cy = y0 + ((y1 - y0) * k) / n;
      const i0 = Math.max(0, Math.floor((cx - r) / DX)), i1 = Math.min(NX - 1, Math.ceil((cx + r) / DX));
      const j0 = Math.max(0, Math.floor((cy - r) / DX)), j1 = Math.min(NY - 1, Math.ceil((cy + r) / DX));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if ((((i + 0.5) * DX - cx) ** 2 + ((j + 0.5) * DX - cy) ** 2) > r * r) continue;
          const o = (j * NX + i) * 4;
          if (this.tool === 'parede') d[o + 1] = 255;
          else if (this.tool === 'vidro') d[o] = 255;
          else d[o] = d[o + 1] = 0;
        }
      }
    }
    s.medDirty = true;
  }

  onPointer(p: PointerInfo) {
    const x = Math.min(LX, Math.max(0, p.wx)), y = Math.min(LY, Math.max(0, p.wy));
    switch (p.kind) {
      case 'hover':
        this.app.stage.canvas.style.cursor = this.hitSource(p.sx, p.sy) >= 0 && (this.tool === 'fonte' || this.tool === 'apagar') ? 'grab' : 'crosshair';
        break;
      case 'down': {
        if (!this.inTank(p.wx, p.wy)) return;
        const si = this.hitSource(p.sx, p.sy);
        if (this.tool === 'fonte') {
          if (si >= 0) {
            this.drag = { kind: 'src', idx: si };
          } else if (this.sources.length < MAX_SOURCES) {
            this.sources.push({ x, y, x2: x, y2: y, line: false, moving: false });
            this.drag = { kind: 'src', idx: this.sources.length - 1 };
          } else {
            this.app.toast(`Máximo de ${MAX_SOURCES} fontes`);
          }
        } else if (this.tool === 'apagar' && si >= 0) {
          this.sources.splice(si, 1);
        } else if (this.tool === 'parede' || this.tool === 'vidro' || this.tool === 'apagar') {
          this.paint(x, y, x, y);
          this.drag = { kind: 'paint', lx: x, ly: y };
        } else if (this.tool === 'sonda') {
          this.probe = [x, y];
          this.drag = { kind: 'probe' };
          this.app.resetCharts();
        } else if (this.tool === 'regua') {
          this.ruler = [x, y, x, y];
          this.drag = { kind: 'ruler' };
        }
        break;
      }
      case 'move': {
        const d = this.drag;
        if (!d) break;
        if (d.kind === 'src') {
          const s = this.sources[d.idx];
          if (!s) break;
          if (s.line) {
            s.x = s.x2 = x;
          } else {
            s.x = s.x2 = x;
            s.y = s.y2 = y;
            if (s.moving) {
              this.movX0 = x;
              this.movT0 = this.t;
            }
          }
        } else if (d.kind === 'paint') {
          this.paint(d.lx, d.ly, x, y);
          d.lx = x;
          d.ly = y;
        } else if (d.kind === 'probe') {
          this.probe = [x, y];
        } else if (this.ruler) {
          this.ruler[2] = x;
          this.ruler[3] = y;
        }
        break;
      }
      case 'up':
      case 'cancel':
        this.drag = null;
        break;
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.ruler) {
      this.ruler = null;
      return true;
    }
    return false;
  }

  // ───────────────────────── renderização ─────────────────────────

  render() {
    const cam = this.app.camera, stage = this.app.stage;
    const { w, h } = stage;
    const s = this.solver;
    if (s) {
      const nx = (x: number) => (cam.sx(x) / w) * 2 - 1;
      const ny = (y: number) => 1 - (cam.sy(y) / h) * 2;
      s.render([nx(0), ny(0), nx(LX), ny(LY)], MODES.indexOf(this.P.mode), 10 ** this.P.gain);
      this.frameN++;
      if (this.probe) {
        const i = Math.min(NX - 1, Math.floor(this.probe[0] / DX)), j = Math.min(NY - 1, Math.floor(this.probe[1] / DX));
        s.readCell(i, j, this.cellBuf);
        this.probeAmp = Math.sqrt(2 * Math.max(0, this.cellBuf[2]));
      }
      if (this.screen !== null && this.frameN % 3 === 0) {
        s.readColumn(Math.min(NX - 1, Math.floor(this.screen / DX)), this.col);
        for (let j = 0; j < NY; j++) this.profile[j] = this.col[j * 4 + 2];
        this.hasProfile = true;
      }
    }

    stage.begin();
    const g = stage.ctx;
    this.drawTank(g);
    if (!s) {
      label(g, 'Simulação de ondas indisponível: requer WebGL2 com texturas float.', cam.sx(2), cam.sy(LY / 2), 'rgba(232,236,244,0.8)', '500 14px Inter, sans-serif');
    }
    this.drawMarkers(g);
    if (this.screen !== null) this.drawScreen(g);
    this.drawSources(g);
    if (this.probe) this.drawProbe(g);
    if (this.ruler) this.drawRuler(g);
    this.drawScale(g);
  }

  private drawTank(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const x0 = cam.sx(0), y0 = cam.sy(LY), x1 = cam.sx(LX), y1 = cam.sy(0);
    g.strokeStyle = 'rgba(160,200,220,0.22)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6, 6);
    g.stroke();
  }

  private drawSources(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.P.f * this.t);
    for (const s of this.sources) {
      if (s.line) {
        const sx = cam.sx(s.x);
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = rgba(TEAL, 0.12);
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(sx, cam.sy(LY));
        g.lineTo(sx, cam.sy(0));
        g.stroke();
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = rgba(TEAL, 0.5 + 0.4 * pulse);
        g.lineWidth = 2;
        g.stroke();
      } else {
        const sx = cam.sx(s.x), sy = cam.sy(s.y);
        g.globalCompositeOperation = 'lighter';
        const r = 16 + 6 * pulse;
        g.drawImage(glowSprite(TEAL, 'halo'), sx - r, sy - r, r * 2, r * 2);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#eafff9';
        g.beginPath();
        g.arc(sx, sy, 3.5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = rgba(TEAL, 0.9);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(sx, sy, 7, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  private drawProbe(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const [x, y] = this.probe!;
    const sx = cam.sx(x), sy = cam.sy(y);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sx, sy, 7, 0, Math.PI * 2);
    for (const [a, b] of [[-13, -9], [9, 13]]) {
      g.moveTo(sx + a, sy); g.lineTo(sx + b, sy);
      g.moveTo(sx, sy + a); g.lineTo(sx, sy + b);
    }
    g.stroke();
    label(g, `A = ${num(this.probeAmp, 2)}`, sx + 12, sy - 12, 'rgba(232,236,244,0.9)', MONO_FONT);
  }

  private drawRuler(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const [x0, y0, x1, y1] = this.ruler!;
    const L = Math.hypot(x1 - x0, y1 - y0);
    const ax = cam.sx(x0), ay = cam.sy(y0), bx = cam.sx(x1), by = cam.sy(y1);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    if (L < 1e-6) return;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    const nsx = -uy, nsy = -ux; // normal em tela
    const lam = this.lambda();
    g.strokeStyle = rgba(TEAL, 0.95);
    g.beginPath();
    for (let d = 0; d <= L + 1e-9; d += lam) {
      const px = cam.sx(x0 + ux * d), py = cam.sy(y0 + uy * d);
      g.moveTo(px - nsx * 6, py - nsy * 6);
      g.lineTo(px + nsx * 6, py + nsy * 6);
    }
    g.stroke();
    label(g, `${num(L, 2)} cm · ${num(L / lam, 2)} λ`, bx + 10, by - 10, 'rgba(232,236,244,0.95)', MONO_FONT);
  }

  private theoryAt(y: number, th: Theory, lam: number): number {
    const L = (this.screen ?? 0) - th.slitX;
    const dy = y - th.yc;
    const sinT = dy / Math.hypot(L, dy);
    const beta = (Math.PI * th.a * sinT) / lam;
    const env = Math.abs(beta) < 1e-6 ? 1 : (Math.sin(beta) / beta) ** 2;
    if (th.kind === 'single') return env / Math.hypot(L, dy);
    const k = (2 * Math.PI) / lam;
    const r1 = Math.hypot(L, y - (th.yc - th.d / 2)), r2 = Math.hypot(L, y - (th.yc + th.d / 2));
    const re = Math.cos(k * r1) / Math.sqrt(r1) + Math.cos(k * r2) / Math.sqrt(r2);
    const im = Math.sin(k * r1) / Math.sqrt(r1) + Math.sin(k * r2) / Math.sqrt(r2);
    return (re * re + im * im) * env;
  }

  private drawScreen(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const X = this.screen!;
    const sx = cam.sx(X);
    g.setLineDash([4, 5]);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(sx, cam.sy(LY));
    g.lineTo(sx, cam.sy(0));
    g.stroke();
    g.setLineDash([]);
    if (!this.hasProfile) return;

    const width = Math.max(1.5, Math.min(3.5, LX - X - 0.3));
    let max = 0;
    for (let j = SPONGE; j < NY - SPONGE; j++) max = Math.max(max, this.profile[j]);
    if (max <= 0) return;

    const th = this.theory;
    if (th && Math.abs(X - th.slitX) > 1) {
      const lam = this.lambda();
      let tmax = 0;
      const vals: number[] = [];
      for (let j = SPONGE; j < NY - SPONGE; j += 2) {
        const v = this.theoryAt((j + 0.5) * DX, th, lam);
        vals.push(v);
        tmax = Math.max(tmax, v);
      }
      g.setLineDash([3, 4]);
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 1.2;
      g.beginPath();
      vals.forEach((v, k) => {
        const y = (SPONGE + k * 2 + 0.5) * DX;
        const px = cam.sx(X + (width * v) / tmax), py = cam.sy(y);
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.stroke();
      g.setLineDash([]);
      label(g, 'teoria', cam.sx(X + width) - 30, cam.sy(LY - 0.8), 'rgba(255,255,255,0.7)', LABEL_FONT);
    }

    g.globalCompositeOperation = 'lighter';
    for (const [lw, a] of [[5, 0.15], [1.8, 0.95]] as const) {
      g.strokeStyle = rgba(WARM, a);
      g.lineWidth = lw;
      g.beginPath();
      for (let j = SPONGE; j < NY - SPONGE; j++) {
        const px = cam.sx(X + (width * this.profile[j]) / max), py = cam.sy((j + 0.5) * DX);
        if (j === SPONGE) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    label(g, 'medido', cam.sx(X) + 4, cam.sy(LY - 0.8), rgba(WARM, 0.95), LABEL_FONT);
  }

  private cross(g: CanvasRenderingContext2D, x: number, y: number, text: string) {
    const cam = this.app.camera;
    const sx = cam.sx(x), sy = cam.sy(y);
    g.strokeStyle = 'rgba(255,220,150,0.95)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(sx - 7, sy); g.lineTo(sx + 7, sy);
    g.moveTo(sx, sy - 7); g.lineTo(sx, sy + 7);
    g.stroke();
    g.beginPath();
    g.arc(sx, sy, 10, 0, Math.PI * 2);
    g.stroke();
    label(g, text, sx + 14, sy - 12, 'rgba(255,220,150,0.95)', LABEL_FONT);
  }

  private drawMarkers(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    switch (this.currentPreset) {
      case 'lente':
        if (this.P.n > 1.02) {
          const fx = LENS.cx + this.lensF();
          if (fx < LX) this.cross(g, fx, LENS.cy, 'foco (lente fina)');
        }
        break;
      case 'parabola':
        this.cross(g, PARABOLA.vx - PARABOLA.F, PARABOLA.cy, 'foco');
        break;
      case 'snell': {
        const t = (SNELL.angle * Math.PI) / 180;
        const nx = Math.cos(t), ny = Math.sin(t);
        const { x, y } = SNELL;
        g.setLineDash([4, 5]);
        g.strokeStyle = 'rgba(255,255,255,0.45)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cam.sx(x - nx * 7), cam.sy(y - ny * 7));
        g.lineTo(cam.sx(x + nx * 9), cam.sy(y + ny * 9));
        g.stroke();
        g.setLineDash([]);
        label(g, 'normal', cam.sx(x + nx * 9) + 6, cam.sy(y + ny * 9), 'rgba(255,255,255,0.6)', LABEL_FONT);
        const phi2 = t - (this.snellTheta2() * Math.PI) / 180;
        arrow(g, cam.sx(x - 7), cam.sy(y), cam.sx(x - 0.3), cam.sy(y), 'rgba(255,220,150,0.95)', 2, 9);
        arrow(g, cam.sx(x), cam.sy(y), cam.sx(x + 7 * Math.cos(phi2)), cam.sy(y + 7 * Math.sin(phi2)), 'rgba(255,220,150,0.95)', 2, 9);
        label(g, `θ₁ = ${SNELL.angle}°`, cam.sx(x - 6.5), cam.sy(y) - 12, 'rgba(255,220,150,0.95)', LABEL_FONT);
        label(g, `θ₂ = ${num(this.snellTheta2(), 1)}°`, cam.sx(x + 7 * Math.cos(phi2)) + 8, cam.sy(y + 7 * Math.sin(phi2)), 'rgba(255,220,150,0.95)', LABEL_FONT);
        break;
      }
      case 'doppler': {
        const src = this.sources.find((s) => s.moving);
        if (!src || this.P.vs <= 1) break;
        const mu = Math.asin(1 / this.P.vs);
        const L = 40;
        g.setLineDash([5, 6]);
        g.strokeStyle = 'rgba(255,220,150,0.7)';
        g.lineWidth = 1.2;
        g.beginPath();
        for (const sgn of [1, -1]) {
          g.moveTo(cam.sx(src.x), cam.sy(src.y));
          g.lineTo(cam.sx(src.x - L * Math.cos(mu)), cam.sy(src.y + sgn * L * Math.sin(mu)));
        }
        g.stroke();
        g.setLineDash([]);
        label(g, 'cone de Mach (teoria)', cam.sx(src.x - 12 * Math.cos(mu)) - 60, cam.sy(src.y + 12 * Math.sin(mu)) - 14, 'rgba(255,220,150,0.9)', LABEL_FONT);
        break;
      }
    }
  }

  private drawScale(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const { w, h } = this.app.stage;
    const s = niceStep(110 / cam.zoom);
    const L = s * cam.zoom;
    const x0 = 22, y0 = h - (w < 720 ? 96 : 30);
    g.strokeStyle = 'rgba(232,236,244,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x0, y0 - 5); g.lineTo(x0, y0); g.lineTo(x0 + L, y0); g.lineTo(x0 + L, y0 - 5);
    g.stroke();
    label(g, s >= 1 ? `${sig(s, 2)} cm` : `${sig(s * 10, 2)} mm`, x0, y0 - 12, 'rgba(232,236,244,0.85)', MONO_FONT);
  }
}
