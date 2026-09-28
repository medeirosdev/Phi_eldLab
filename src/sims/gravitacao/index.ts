import type {
  ChartDef, ParamDef, ParamValue, PointerInfo, ReadoutDef, SimContext, Simulation,
} from '../../core/types';
import { glowSprite, hexToRgb, mix, rgba, type RGB } from '../../core/render/glow';
import { arrow, label } from '../../core/render/draw';
import { Trail } from '../../core/render/trail';
import { niceStep, num, sci, sig } from '../../core/units';
import { drawStarfield } from './background';
import {
  ANGMOM, AU, G, JOULE, KMS, MEARTH, MJUP, NBody, REARTH, RJUP, RSUN, type Integrator,
} from './physics';
import { PRESETS, buildScene, type BodySpec, type Kind } from './presets';

const ACCENT: RGB = [255, 181, 71];
const VEL: RGB = [62, 230, 196];
const ACC: RGB = [255, 90, 138];
const PLANET_COLORS = ['#7cc4ff', '#8affc1', '#ffd36e', '#ff8fa3', '#c9a0ff', '#6ee7f2', '#ffa36e'];
const USER_DUST_TAG = 3;
const LABEL_FONT = '500 11px Inter, system-ui, sans-serif';
const MONO_FONT = '500 11px "JetBrains Mono", ui-monospace, monospace';

const NEW_KINDS: Record<string, { m: number; name: string }> = {
  rocky: { m: MEARTH, name: 'Planeta' },
  giant: { m: MJUP, name: 'Gigante' },
  red: { m: 0.2, name: 'Anã vermelha' },
  star: { m: 1, name: 'Estrela' },
  dust: { m: 0, name: 'Poeira' },
};

interface Meta {
  name: string;
  rgb: RGB;
  kind: Kind;
  radius: number;
  trail: Trail;
}

interface Elements {
  /** Índice do corpo dominante (foco da cônica). */
  j: number;
  r: number;
  v: number;
  a: number;
  e: number;
  ex: number;
  ey: number;
  p: number;
  T: number;
}

interface Drag {
  wx0: number;
  wy0: number;
  sx0: number;
  sy0: number;
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  moved: boolean;
}

export function kindOf(m: number): Kind {
  return m >= 0.08 ? 'star' : m >= 10 * MEARTH ? 'giant' : 'rocky';
}

/** Raios físicos reais (UA) a partir de relações massa-raio aproximadas. */
function radiusOf(m: number, k: Kind): number {
  if (m <= 0) return 0;
  if (k === 'star') return RSUN * Math.pow(m, 0.8);
  if (k === 'giant') return RJUP * Math.min(1.1, Math.pow(m / MJUP, 0.35));
  return REARTH * Math.pow(m / MEARTH, 0.27);
}

/** Cor aproximada pela temperatura: anãs vermelhas, estrelas tipo Sol, estrelas azuis. */
function starRGB(m: number): RGB {
  if (m < 0.45) return [255, 138, 92];
  if (m < 0.8) return [255, 186, 120];
  if (m < 1.4) return [255, 222, 160];
  if (m < 3) return [226, 234, 255];
  return [160, 196, 255];
}

function fmtTime(t: number): string {
  const a = Math.abs(t);
  if (a < 2 / 365.25) return `${num(t * 8766, 1)} h`;
  if (a < 2) return `${num(t * 365.25, 1)} dias`;
  return `${num(t, 2)} anos`;
}

function fmtMass(m: number): string {
  if (m <= 0) return '0 (partícula de teste)';
  if (m >= 0.08) return `${sig(m, 4)} M☉`;
  if (m >= 10 * MEARTH) return `${sig(m / MJUP, 3)} M♃`;
  return `${sig(m / MEARTH, 3)} M⊕`;
}

export default class Gravitacao implements Simulation {
  readonly presets = PRESETS;
  readonly time = { dt: 0.002, scale: 0.5 };
  readonly hint =
    '<b>Arraste</b> para lançar um corpo · <b>toque</b> para criar uma órbita circular · <b>clique</b> num corpo para inspecioná-lo · <kbd>Shift</kbd>/botão direito move a câmera · roda = zoom';
  currentPreset = 'solar';

  private app!: SimContext;
  private nb = new NBody(512);
  private pnb = new NBody(64);
  private meta: Meta[] = [];
  private t = 0;
  private sel = -1;
  private en = { K: 0, U: 0 };
  private L = 0;
  private E0 = 0;
  private L0 = 0;
  /** max(|E₀|, K₀): escala do erro de energia (E₀ ≈ 0 em encontros parabólicos). */
  private Escale = 0;
  /** Σ|mᵢ rᵢ×vᵢ|: escala para o erro relativo de L (o L total pode ser zero). */
  private Lscale = 0;
  private el: Elements | null = null;
  private dustSprites: HTMLCanvasElement[] = [];
  private effects: { x: number; y: number; t0: number; rgb: RGB }[] = [];
  private drag: Drag | null = null;
  private pressBody = -1;
  private preview: { path: Float64Array; count: number; hit: boolean } | null = null;
  private previewDirty = false;
  private colorIdx = 0;
  private counters: Record<string, number> = {};

  // 2ª lei de Kepler: amostras da posição relativa ao foco
  private kepJ = -1;
  private kepT0 = 0;
  private kepDelta = 0;
  private kepT: number[] = [];
  private kepX: number[] = [];
  private kepY: number[] = [];
  private kepAreas: number[] = [];

  private P = {
    newKind: 'rocky',
    trails: true,
    trailLen: 1200,
    names: true,
    grid: true,
    vel: false,
    acc: false,
    orbit: true,
    kepler: false,
    follow: 'livre',
    integrator: 'verlet' as Integrator,
    collisions: true,
    eps: -5,
    eta: '0.02',
  };

  readonly params: ParamDef[] = [
    {
      type: 'select', key: 'newKind', label: 'Tipo do novo corpo', group: 'Novo corpo', value: 'rocky',
      options: [
        { value: 'rocky', label: 'Planeta rochoso · 1 M⊕' },
        { value: 'giant', label: 'Gigante gasoso · 1 M♃' },
        { value: 'red', label: 'Anã vermelha · 0,2 M☉' },
        { value: 'star', label: 'Estrela · 1 M☉' },
        { value: 'dust', label: 'Poeira (partícula de teste)' },
      ],
    },
    { type: 'toggle', key: 'trails', label: 'Rastros', group: 'Visualização', value: true },
    {
      type: 'range', key: 'trailLen', label: 'Comprimento do rastro', group: 'Visualização',
      min: 100, max: 4000, step: 100, value: 1200, format: (v) => `${num(v, 0)} pts`,
    },
    { type: 'toggle', key: 'names', label: 'Nomes', group: 'Visualização', value: true },
    { type: 'toggle', key: 'grid', label: 'Grade e escala', group: 'Visualização', value: true },
    {
      type: 'toggle', key: 'vel', label: 'Vetores velocidade', group: 'Visualização', value: false,
      hint: 'Direção exata; comprimento relativo ao corpo mais rápido.',
    },
    {
      type: 'toggle', key: 'acc', label: 'Vetores aceleração', group: 'Visualização', value: false,
      hint: 'Aponta sempre para onde a gravidade resultante puxa.',
    },
    {
      type: 'toggle', key: 'orbit', label: 'Órbita kepleriana do selecionado', group: 'Visualização', value: true,
      hint: 'Cônica calculada a partir da posição e velocidade instantâneas (elementos osculadores).',
    },
    {
      type: 'toggle', key: 'kepler', label: '2ª lei de Kepler (áreas)', group: 'Visualização', value: false,
      hint: 'Setores varridos pelo raio vetor em intervalos iguais de tempo (T/12): as áreas são iguais.',
    },
    {
      type: 'select', key: 'follow', label: 'Seguir', group: 'Câmera', value: 'livre',
      options: [
        { value: 'livre', label: 'Livre' },
        { value: 'cm', label: 'Centro de massa' },
        { value: 'sel', label: 'Selecionado' },
      ],
    },
    {
      type: 'select', key: 'integrator', label: 'Integrador numérico', group: 'Física', value: 'verlet',
      hint: 'Verlet é simplético (conserva energia a longo prazo). RK4 é preciso mas deriva. Euler falha.',
      options: [
        { value: 'verlet', label: 'Verlet' },
        { value: 'rk4', label: 'RK4' },
        { value: 'euler', label: 'Euler' },
      ],
    },
    {
      type: 'select', key: 'eta', label: 'Precisão do passo adaptativo', group: 'Física', value: '0.02',
      hint: 'Cada subpasso usa h ≤ η·√(r³/GM) do par mais próximo. η menor = mais preciso em encontros próximos, porém mais lento.',
      options: [
        { value: '0.05', label: 'Rápida · η = 0,05' },
        { value: '0.02', label: 'Normal · η = 0,02' },
        { value: '0.005', label: 'Alta · η = 0,005' },
        { value: '0.002', label: 'Máxima · η = 0,002' },
      ],
    },
    { type: 'toggle', key: 'collisions', label: 'Colisões (fusão inelástica)', group: 'Física', value: true },
    {
      type: 'range', key: 'eps', label: 'Suavização ε', group: 'Física', min: -6, max: 0, step: 0.25, value: -5,
      format: (v) => `${sci(10 ** v, 2)} UA`,
      hint: 'Suavização de Plummer: F ∝ 1/(r² + ε²). Evita forças infinitas em encontros muito próximos.',
    },
  ];

  readonly readouts: ReadoutDef[] = [
    { key: 't', group: 'Sistema', label: 'Tempo', get: () => fmtTime(this.t) },
    {
      key: 'n', group: 'Sistema', label: 'Corpos',
      get: () => {
        const d = this.nb.n - this.nb.nm;
        return d > 0 ? `${this.nb.nm} + ${d} poeira` : `${this.nb.nm}`;
      },
    },
    { key: 'E', group: 'Sistema', label: 'Energia total', get: () => `${sci((this.en.K + this.en.U) * JOULE)} J` },
    {
      key: 'dE', group: 'Sistema', label: 'Erro de energia',
      hint: 'Deriva numérica |ΔE| desde o último evento (colisão, novo corpo...), relativa a max(|E₀|, K₀). Mede a precisão do integrador: a física exata conservaria E.',
      get: () => (this.nb.nm < 2 || this.Escale === 0 ? '—' : sci(Math.abs(this.en.K + this.en.U - this.E0) / this.Escale, 2)),
    },
    { key: 'L', group: 'Sistema', label: 'Momento angular', get: () => `${sci(this.L * ANGMOM)} kg·m²/s` },
    {
      key: 'dL', group: 'Sistema', label: 'Erro de L',
      hint: 'Relativo a Σ|mᵢ rᵢ×vᵢ|, pois o momento angular total pode ser nulo (ex.: figura-8).',
      get: () => (this.nb.nm < 2 || this.Lscale === 0 ? '—' : sci(Math.abs(this.L - this.L0) / this.Lscale, 2)),
    },
    {
      key: 'dt', group: 'Sistema', label: 'Passo efetivo',
      hint: 'O passo é subdividido automaticamente em encontros próximos.',
      get: () => `${fmtTime(this.time.dt / this.nb.substeps)}${this.nb.substeps > 1 ? ` (÷${this.nb.substeps})` : ''}`,
    },

    { key: 'name', group: 'Corpo selecionado', label: 'Nome', visible: () => this.sel >= 0, get: () => this.meta[this.sel]?.name ?? '' },
    { key: 'mass', group: 'Corpo selecionado', label: 'Massa', visible: () => this.sel >= 0, get: () => fmtMass(this.nb.m[this.sel]) },
    { key: 'prim', group: 'Corpo selecionado', label: 'Orbita', visible: () => !!this.el, get: () => this.meta[this.el!.j].name },
    { key: 'r', group: 'Corpo selecionado', label: 'Distância r', visible: () => !!this.el, get: () => this.fmtDist(this.el!.r) },
    { key: 'v', group: 'Corpo selecionado', label: 'Velocidade orbital', visible: () => !!this.el, get: () => `${num(this.el!.v * KMS, 2)} km/s` },
    {
      key: 'a', group: 'Corpo selecionado', label: 'Semieixo maior a', visible: () => !!this.el,
      get: () => (this.el!.e < 1 ? this.fmtDist(this.el!.a) : 'órbita aberta'),
    },
    { key: 'e', group: 'Corpo selecionado', label: 'Excentricidade e', visible: () => !!this.el, get: () => num(this.el!.e, 4) },
    {
      key: 'T', group: 'Corpo selecionado', label: 'Período T', visible: () => !!this.el && this.el.e < 1,
      get: () => fmtTime(this.el!.T),
    },
    {
      key: 'k3', group: 'Corpo selecionado', label: 'T²/a³ (3ª lei)', visible: () => !!this.el && this.el.e < 1,
      hint: '3ª lei de Kepler: T²/a³ = 4π²/G(M+m). Para qualquer órbita em torno do Sol, ≈ 1 ano²/UA³.',
      get: () => `${num((this.el!.T * this.el!.T) / this.el!.a ** 3, 4)} ano²/UA³`,
    },
    {
      key: 'areas', group: 'Corpo selecionado', label: 'Áreas (Δt = T/12)', visible: () => this.P.kepler && this.kepAreas.length >= 2,
      hint: '2ª lei de Kepler: o raio vetor varre áreas iguais em tempos iguais.',
      get: () => {
        const a = this.kepAreas;
        return `${sig(a[a.length - 2], 4)} · ${sig(a[a.length - 1], 4)} UA²`;
      },
    },
  ];

  readonly charts: ChartDef[] = [
    {
      title: 'Energia do sistema',
      format: (v) => `${sci(v)} J`,
      series: [
        { label: 'Cinética K', color: '#ff7a8a', get: () => this.en.K * JOULE },
        { label: 'Potencial U', color: '#5ab0ff', get: () => this.en.U * JOULE },
        { label: 'Total E = K + U', color: '#f4f4f4', get: () => (this.en.K + this.en.U) * JOULE },
      ],
    },
  ];

  init(ctx: SimContext) {
    this.app = ctx;
    ctx.stage.drawBackground = drawStarfield;
    ctx.stage.paintBackground();
    ctx.camera.onManualMove = () => {
      if (this.P.follow !== 'livre') {
        this.setParam('follow', 'livre');
        this.app.refreshUI();
      }
    };
    this.loadPreset(this.currentPreset);
  }

  dispose() {
    this.app.camera.onManualMove = null;
    this.app.stage.drawBackground = null;
  }

  // ───────────────────────── cenário ─────────────────────────

  loadPreset(id: string) {
    const sc = buildScene(id);
    this.currentPreset = id;
    this.nb.clear();
    this.meta = [];
    this.colorIdx = 0;
    this.counters = {};
    this.effects = [];
    this.sel = -1;
    this.t = 0;
    this.setParam('eps', Math.log10(sc.eps));
    this.nb.eps2 = sc.eps * sc.eps;
    this.setParam('collisions', sc.collisions ?? true);
    this.setParam('eta', String(sc.eta ?? 0.02));
    this.setParam('follow', 'livre');
    for (const b of sc.bodies) this.addBody(b);
    for (const d of sc.dust) this.nb.addTest(d.x, d.y, d.vx, d.vy, d.tag);
    const pal = [...(sc.dustPalette ?? [])];
    while (pal.length < USER_DUST_TAG) pal.push('#9fb3d9');
    pal[USER_DUST_TAG] = '#e8ecf4';
    this.dustSprites = pal.map((c) => glowSprite(hexToRgb(c), 'dot'));
    this.time.dt = sc.dt;
    this.time.scale = sc.scale;
    this.app.camera.fit(0, 0, sc.halfHeight, true);
    this.resetRef();
    this.kepStart();
    this.app.resetCharts();
    this.app.refreshUI();
  }

  private setParam(key: string, value: ParamValue) {
    (this.P as Record<string, ParamValue>)[key] = value;
    const def = this.params.find((p) => p.key === key);
    if (def) def.value = value as never;
  }

  private addBody(b: BodySpec) {
    const kind = b.kind ?? kindOf(b.m);
    const rgb = b.color
      ? hexToRgb(b.color)
      : kind === 'star'
        ? starRGB(b.m)
        : hexToRgb(PLANET_COLORS[this.colorIdx++ % PLANET_COLORS.length]);
    this.nb.addMassive(b.x, b.y, b.vx, b.vy, b.m);
    this.meta.push({ name: b.name, rgb, kind, radius: radiusOf(b.m, kind), trail: new Trail(this.P.trailLen) });
  }

  private removeBody(i: number) {
    const last = this.nb.nm - 1;
    this.nb.removeMassive(i);
    if (i !== last) this.meta[i] = this.meta[last];
    this.meta.pop();
    if (this.sel === i) this.sel = -1;
    else if (this.sel === last) this.sel = i;
    this.resetRef();
    this.kepStart();
  }

  /** Nova referência para medir o erro numérico de E e L. */
  private resetRef() {
    this.nb.ensureAcc();
    const e = this.nb.energy();
    this.en = e;
    this.E0 = e.K + e.U;
    this.Escale = Math.max(Math.abs(this.E0), e.K);
    this.L = this.L0 = this.nb.angMom();
    const nb = this.nb;
    this.Lscale = 0;
    for (let i = 0; i < nb.nm; i++) this.Lscale += Math.abs(nb.m[i] * (nb.x[i] * nb.vy[i] - nb.y[i] * nb.vx[i]));
  }

  onParam(key: string, value: ParamValue) {
    (this.P as Record<string, ParamValue>)[key] = value;
    switch (key) {
      case 'trailLen':
        for (const m of this.meta) m.trail = new Trail(value as number);
        break;
      case 'trails':
        for (const m of this.meta) m.trail.clear();
        break;
      case 'kepler':
        this.kepStart();
        break;
      case 'integrator':
        this.nb.accValid = false;
        this.resetRef();
        break;
      case 'eps':
        this.nb.eps2 = (10 ** (value as number)) ** 2;
        this.nb.accValid = false;
        this.resetRef();
        break;
      case 'follow':
        if (value === 'sel' && this.sel < 0) this.app.toast('Clique num corpo para a câmera segui-lo');
        break;
    }
  }

  // ───────────────────────── física ─────────────────────────

  step(dt: number) {
    const nb = this.nb;
    nb.step(dt, this.P.integrator, Number(this.P.eta), nb.nm <= 10 ? 1e5 : 256);
    this.t += dt;
    if (this.P.collisions) this.collide();
    if (this.P.trails) {
      const d = 1.2 / this.app.camera.zoom;
      const d2 = d * d;
      for (let i = 0; i < nb.nm; i++) this.meta[i].trail.push(nb.x[i], nb.y[i], d2);
    }
    if (this.P.kepler && this.sel >= 0) this.kepSample();
  }

  private collide() {
    const { x, y } = this.nb;
    const nm = this.nb.nm;
    for (let i = 0; i < nm; i++) {
      for (let j = i + 1; j < nm; j++) {
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const R = this.meta[i].radius + this.meta[j].radius;
        if (dx * dx + dy * dy < R * R) {
          this.merge(i, j);
          return;
        }
      }
    }
    // poeira que atinge a superfície de um corpo é absorvida
    for (let p = nm; p < this.nb.n; p++) {
      for (let j = 0; j < nm; j++) {
        const dx = x[j] - x[p], dy = y[j] - y[p];
        const R = this.meta[j].radius;
        if (dx * dx + dy * dy < R * R) {
          this.nb.removeTest(p);
          p--;
          break;
        }
      }
    }
  }

  /** Colisão perfeitamente inelástica: conserva massa e momento linear. */
  private merge(i: number, j: number) {
    const nb = this.nb;
    const a = nb.m[i] >= nb.m[j] ? i : j;
    const b = a === i ? j : i;
    const M = nb.m[a] + nb.m[b];
    if (M > 0) {
      nb.x[a] = (nb.m[a] * nb.x[a] + nb.m[b] * nb.x[b]) / M;
      nb.y[a] = (nb.m[a] * nb.y[a] + nb.m[b] * nb.y[b]) / M;
      nb.vx[a] = (nb.m[a] * nb.vx[a] + nb.m[b] * nb.vx[b]) / M;
      nb.vy[a] = (nb.m[a] * nb.vy[a] + nb.m[b] * nb.vy[b]) / M;
    }
    nb.m[a] = M;
    const A = this.meta[a], B = this.meta[b];
    A.kind = kindOf(M);
    A.radius = radiusOf(M, A.kind);
    if (A.kind === 'star' && B.kind === 'star') A.rgb = starRGB(M);
    this.effects.push({ x: nb.x[a], y: nb.y[a], t0: performance.now(), rgb: mix(A.rgb, [255, 255, 255], 0.4) });
    const lastBefore = nb.nm - 1;
    const selWasB = this.sel === b;
    this.removeBody(b);
    const newA = a === lastBefore ? b : a;
    if (selWasB) this.sel = newA;
    this.kepStart();
    this.app.toast(`${B.name} colidiu com ${A.name}`);
  }

  /** Corpo que exerce a maior aceleração no ponto (x, y). */
  private dominant(x: number, y: number, exclude: number): number {
    const nb = this.nb;
    let best = -1, bestA = 0;
    for (let j = 0; j < nb.nm; j++) {
      if (j === exclude || nb.m[j] <= 0) continue;
      const dx = nb.x[j] - x, dy = nb.y[j] - y;
      const a = nb.m[j] / (dx * dx + dy * dy + nb.eps2);
      if (a > bestA) {
        bestA = a;
        best = j;
      }
    }
    return best;
  }

  /** Elementos orbitais osculadores do corpo i em relação ao seu corpo dominante. */
  private elements(i: number): Elements | null {
    const nb = this.nb;
    const j = this.dominant(nb.x[i], nb.y[i], i);
    if (j < 0) return null;
    const rx = nb.x[i] - nb.x[j], ry = nb.y[i] - nb.y[j];
    const vx = nb.vx[i] - nb.vx[j], vy = nb.vy[i] - nb.vy[j];
    const mu = G * (nb.m[i] + nb.m[j]);
    const r = Math.hypot(rx, ry);
    const v2 = vx * vx + vy * vy;
    const rv = rx * vx + ry * vy;
    const h = rx * vy - ry * vx;
    const ex = ((v2 - mu / r) * rx - rv * vx) / mu;
    const ey = ((v2 - mu / r) * ry - rv * vy) / mu;
    const e = Math.hypot(ex, ey);
    const inv = 2 / r - v2 / mu;
    const a = inv !== 0 ? 1 / inv : Infinity;
    const T = e < 1 && a > 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
    return { j, r, v: Math.sqrt(v2), a, e, ex, ey, p: (h * h) / mu, T };
  }

  // ───────────────────────── 2ª lei de Kepler ─────────────────────────

  private kepStart() {
    this.kepT = [];
    this.kepX = [];
    this.kepY = [];
    this.kepAreas = [];
    this.kepDelta = 0;
    if (!this.P.kepler || this.sel < 0) return;
    const el = this.elements(this.sel);
    if (!el || el.e >= 1 || !Number.isFinite(el.T)) return;
    this.kepJ = el.j;
    this.kepDelta = el.T / 12;
    this.kepT0 = this.t;
  }

  private kepSample() {
    const nb = this.nb, i = this.sel, j = this.kepJ;
    if (this.kepDelta <= 0 || j < 0 || j >= nb.nm) return;
    this.kepT.push(this.t);
    this.kepX.push(nb.x[i] - nb.x[j]);
    this.kepY.push(nb.y[i] - nb.y[j]);
    const cur = Math.floor((this.t - this.kepT0) / this.kepDelta);
    let drop = 0;
    while (drop < this.kepT.length && Math.floor((this.kepT[drop] - this.kepT0) / this.kepDelta) < cur - 11) drop++;
    if (drop > 64 || (drop > 0 && this.kepT.length > 4000)) {
      this.kepT.splice(0, drop);
      this.kepX.splice(0, drop);
      this.kepY.splice(0, drop);
    }
  }

  // ───────────────────────── interação ─────────────────────────

  private coreSize(i: number): number {
    const M = this.meta[i];
    const zr = M.radius * this.app.camera.zoom;
    if (M.kind === 'star') return Math.max(zr, 3 + 2.4 * Math.pow(this.nb.m[i], 0.35));
    if (M.kind === 'giant') return Math.max(zr, 3.2);
    return Math.max(zr, 2.3);
  }

  private hit(sx: number, sy: number): number {
    const cam = this.app.camera, nb = this.nb;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < nb.nm; i++) {
      const d = Math.hypot(cam.sx(nb.x[i]) - sx, cam.sy(nb.y[i]) - sy);
      if (d < Math.max(14, this.coreSize(i) + 6) && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  /** Velocidade de lançamento: relativa ao corpo dominante naquele ponto. */
  private launchVel(d: Drag): { vx: number; vy: number; vrel: number } {
    const nb = this.nb;
    const j = this.dominant(d.wx0, d.wy0, -1);
    const bvx = j >= 0 ? nb.vx[j] : 0, bvy = j >= 0 ? nb.vy[j] : 0;
    let rvx = 0, rvy = 0;
    if (!d.moved) {
      if (j >= 0) {
        const rx = d.wx0 - nb.x[j], ry = d.wy0 - nb.y[j];
        const r = Math.hypot(rx, ry) || 1e-9;
        const v = Math.sqrt((G * (nb.m[j] + NEW_KINDS[this.P.newKind].m)) / r);
        rvx = (-ry / r) * v;
        rvy = (rx / r) * v;
      }
    } else {
      const k = 50 / Math.pow(this.app.camera.halfHeight(), 1.5);
      rvx = (d.wx - d.wx0) * k;
      rvy = (d.wy - d.wy0) * k;
    }
    return { vx: bvx + rvx, vy: bvy + rvy, vrel: Math.hypot(rvx, rvy) };
  }

  private launch(d: Drag) {
    const kindKey = this.P.newKind;
    const spec = NEW_KINDS[kindKey];
    const v = this.launchVel(d);
    if (kindKey === 'dust') {
      this.nb.addTest(d.wx0, d.wy0, v.vx, v.vy, USER_DUST_TAG);
      return;
    }
    const n = (this.counters[kindKey] = (this.counters[kindKey] ?? 0) + 1);
    this.addBody({ name: `${spec.name} ${n}`, m: spec.m, x: d.wx0, y: d.wy0, vx: v.vx, vy: v.vy });
    this.resetRef();
  }

  private select(i: number) {
    this.sel = this.sel === i ? -1 : i;
    this.kepStart();
  }

  onPointer(p: PointerInfo) {
    const canvas = this.app.stage.canvas;
    switch (p.kind) {
      case 'hover':
        canvas.style.cursor = this.hit(p.sx, p.sy) >= 0 ? 'pointer' : 'crosshair';
        break;
      case 'down': {
        const hb = this.hit(p.sx, p.sy);
        if (hb >= 0) {
          this.pressBody = hb;
          this.drag = null;
        } else {
          this.pressBody = -1;
          this.drag = { wx0: p.wx, wy0: p.wy, sx0: p.sx, sy0: p.sy, sx: p.sx, sy: p.sy, wx: p.wx, wy: p.wy, moved: false };
        }
        break;
      }
      case 'move': {
        const d = this.drag;
        if (!d) break;
        d.sx = p.sx; d.sy = p.sy; d.wx = p.wx; d.wy = p.wy;
        if (!d.moved && Math.hypot(p.sx - d.sx0, p.sy - d.sy0) > 6) d.moved = true;
        this.previewDirty = true;
        break;
      }
      case 'up':
        if (this.pressBody >= 0 && this.pressBody < this.nb.nm) this.select(this.pressBody);
        else if (this.drag) this.launch(this.drag);
        this.drag = null;
        this.preview = null;
        this.pressBody = -1;
        break;
      case 'cancel':
        this.drag = null;
        this.preview = null;
        this.pressBody = -1;
        break;
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.sel >= 0) {
      this.sel = -1;
      this.kepStart();
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) {
      const name = this.meta[this.sel].name;
      this.removeBody(this.sel);
      this.app.toast(`${name} removido`);
      return true;
    }
    return false;
  }

  /** Trajetória prevista do corpo sendo lançado (integra uma cópia do sistema). */
  private predict(d: Drag) {
    const nb = this.nb, pnb = this.pnb;
    pnb.clear();
    pnb.eps2 = nb.eps2;
    for (let i = 0; i < nb.nm; i++) pnb.addMassive(nb.x[i], nb.y[i], nb.vx[i], nb.vy[i], nb.m[i]);
    const v = this.launchVel(d);
    const mNew = NEW_KINDS[this.P.newKind].m;
    const k = pnb.addMassive(d.wx0, d.wy0, v.vx, v.vy, mNew);
    const rNew = radiusOf(mNew, kindOf(mNew));

    let horizon = 30 * this.time.scale;
    const j = this.dominant(d.wx0, d.wy0, -1);
    if (j >= 0) {
      const rx = d.wx0 - nb.x[j], ry = d.wy0 - nb.y[j];
      const r = Math.hypot(rx, ry);
      const v2 = (v.vx - nb.vx[j]) ** 2 + (v.vy - nb.vy[j]) ** 2;
      const mu = G * (nb.m[j] + mNew);
      const eps = v2 / 2 - mu / r;
      if (eps < 0) {
        const a = -mu / (2 * eps);
        horizon = Math.min(horizon, 2 * Math.PI * Math.sqrt((a * a * a) / mu) * 1.02);
      } else {
        horizon = Math.min(horizon, (4 * r) / Math.sqrt(v2));
      }
    }
    horizon = Math.max(horizon, this.time.dt * 20);

    const steps = nb.nm > 30 ? 240 : 480;
    const h = horizon / steps;
    const path = new Float64Array((steps + 1) * 2);
    path[0] = d.wx0;
    path[1] = d.wy0;
    let count = 1, hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      pnb.step(h, 'verlet', 0.02, 32);
      const px = pnb.x[k], py = pnb.y[k];
      path[count * 2] = px;
      path[count * 2 + 1] = py;
      count++;
      for (let i = 0; i < k; i++) {
        const R = this.meta[i].radius + rNew;
        if ((pnb.x[i] - px) ** 2 + (pnb.y[i] - py) ** 2 < R * R) {
          hit = true;
          break;
        }
      }
    }
    this.preview = { path, count, hit };
  }

  // ───────────────────────── renderização ─────────────────────────

  clock() {
    return `t = ${fmtTime(this.t)}`;
  }

  speedLabel(mult: number) {
    const r = this.time.scale * mult;
    if (r < 2 / 365.25) return `${sig(r * 8766, 2)} h/s`;
    if (r < 1) return `${sig(r * 365.25, 2)} dias/s`;
    return `${sig(r, 2)} anos/s`;
  }

  private fmtDist(au: number): string {
    return au >= 0.01 ? `${sig(au, 4)} UA` : `${sci((au * AU) / 1000, 3)} km`;
  }

  render() {
    const cam = this.app.camera, nb = this.nb;
    if (this.P.follow === 'cm' && nb.nm > 0) {
      const c = nb.com();
      cam.track(c.x, c.y);
    } else if (this.P.follow === 'sel' && this.sel >= 0) {
      cam.track(nb.x[this.sel], nb.y[this.sel]);
    }

    this.en = nb.energy();
    this.L = nb.angMom();
    this.el = this.sel >= 0 ? this.elements(this.sel) : null;
    if (this.drag?.moved && this.previewDirty) {
      this.predict(this.drag);
      this.previewDirty = false;
    }

    this.app.stage.begin();
    const g = this.app.stage.ctx;
    if (this.P.grid) this.drawGrid(g);
    if (this.P.kepler && this.sel >= 0) this.drawKepler(g);
    if (this.P.orbit && this.el) this.drawConic(g, this.el);
    if (this.P.trails) this.drawTrails(g);
    this.drawDust(g);
    this.drawBodies(g);
    if (this.P.vel || this.P.acc) this.drawVectors(g);
    if (this.sel >= 0) this.drawSelection(g);
    this.drawEffects(g);
    if (this.drag) this.drawDrag(g);
    if (this.P.grid) this.drawScale(g);
  }

  private drawGrid(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const { w, h } = this.app.stage;
    const step = niceStep(90 / cam.zoom);
    const tl = cam.toWorld(0, 0), br = cam.toWorld(w, h);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(150,170,220,0.05)';
    g.beginPath();
    for (let X = Math.ceil(tl.x / step) * step; X <= br.x; X += step) {
      const sx = Math.round(cam.sx(X)) + 0.5;
      g.moveTo(sx, 0);
      g.lineTo(sx, h);
    }
    for (let Y = Math.ceil(br.y / step) * step; Y <= tl.y; Y += step) {
      const sy = Math.round(cam.sy(Y)) + 0.5;
      g.moveTo(0, sy);
      g.lineTo(w, sy);
    }
    g.stroke();
    g.strokeStyle = 'rgba(150,170,220,0.1)';
    g.beginPath();
    const ox = Math.round(cam.sx(0)) + 0.5, oy = Math.round(cam.sy(0)) + 0.5;
    g.moveTo(ox, 0); g.lineTo(ox, h);
    g.moveTo(0, oy); g.lineTo(w, oy);
    g.stroke();
  }

  private drawScale(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const { w, h } = this.app.stage;
    const want = 110 / cam.zoom;
    let s: number, text: string;
    if (want >= 0.01) {
      s = niceStep(want);
      text = `${sig(s, 2)} UA`;
    } else {
      const km = niceStep((want * AU) / 1000);
      s = (km * 1000) / AU;
      text = `${sci(km, 1)} km`;
    }
    const L = s * cam.zoom;
    const x0 = 22, y0 = h - (w < 720 ? 96 : 30);
    g.strokeStyle = 'rgba(232,236,244,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x0, y0 - 5); g.lineTo(x0, y0); g.lineTo(x0 + L, y0); g.lineTo(x0 + L, y0 - 5);
    g.stroke();
    label(g, text, x0, y0 - 12, 'rgba(232,236,244,0.85)', MONO_FONT);
  }

  private drawTrails(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, nb = this.nb;
    const chunks = 14;
    const glow = nb.nm <= 40;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < nb.nm; i++) {
      const M = this.meta[i], tr = M.trail, L = tr.len;
      if (L < 2) continue;
      const per = Math.ceil(L / chunks);
      for (let pass = glow ? 0 : 1; pass < 2; pass++) {
        g.lineWidth = pass === 0 ? 5 : M.kind === 'star' ? 1.8 : 1.4;
        for (let c = 0; c < chunks; c++) {
          const s = c * per;
          const e = Math.min(L - 1, (c + 1) * per);
          if (s >= e) continue;
          const f = Math.pow((c + 1) / chunks, 1.6);
          g.strokeStyle = rgba(M.rgb, pass === 0 ? f * 0.07 : f * 0.85);
          g.beginPath();
          g.moveTo(cam.sx(tr.x(s)), cam.sy(tr.y(s)));
          for (let k = s + 1; k <= e; k++) g.lineTo(cam.sx(tr.x(k)), cam.sy(tr.y(k)));
          if (e === L - 1) g.lineTo(cam.sx(nb.x[i]), cam.sy(nb.y[i]));
          g.stroke();
        }
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  private drawDust(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, nb = this.nb;
    if (nb.n === nb.nm) return;
    const { w, h } = this.app.stage;
    const s = 5, hs = s / 2;
    g.globalCompositeOperation = 'lighter';
    for (let p = nb.nm; p < nb.n; p++) {
      const sx = cam.sx(nb.x[p]), sy = cam.sy(nb.y[p]);
      if (sx < -s || sy < -s || sx > w + s || sy > h + s) continue;
      g.drawImage(this.dustSprites[nb.tag[p]] ?? this.dustSprites[0], sx - hs, sy - hs, s, s);
    }
    g.globalCompositeOperation = 'source-over';
  }

  private drawBodies(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, nb = this.nb;
    const { w, h } = this.app.stage;
    const pos: number[] = [];
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < nb.nm; i++) {
      const M = this.meta[i];
      const sx = cam.sx(nb.x[i]), sy = cam.sy(nb.y[i]);
      const core = this.coreSize(i);
      const halo = M.kind === 'star' ? core * 4 + 30 * Math.pow(nb.m[i], 0.3) : core * 3.2 + 5;
      pos.push(sx, sy, core);
      if (sx < -halo || sy < -halo || sx > w + halo || sy > h + halo) continue;
      g.drawImage(glowSprite(M.rgb, 'halo'), sx - halo, sy - halo, halo * 2, halo * 2);
    }
    g.globalCompositeOperation = 'source-over';

    for (let i = 0; i < nb.nm; i++) {
      const M = this.meta[i];
      const sx = pos[i * 3], sy = pos[i * 3 + 1], core = pos[i * 3 + 2];
      if (sx < -core || sy < -core || sx > w + core || sy > h + core) continue;
      let fill: string | CanvasGradient;
      if (M.kind === 'star') {
        const gr = g.createRadialGradient(sx, sy, 0, sx, sy, core);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.55, rgba(mix(M.rgb, [255, 255, 255], 0.55), 1));
        gr.addColorStop(1, rgba(M.rgb, 1));
        fill = gr;
      } else if (core >= 2.6 && nb.nm <= 60) {
        // fase iluminada pela estrela mais influente
        const l = this.lightDir(i, sx, sy);
        const gr = g.createRadialGradient(sx + l[0] * core * 0.5, sy + l[1] * core * 0.5, core * 0.1, sx, sy, core * 1.1);
        gr.addColorStop(0, rgba(mix(M.rgb, [255, 255, 255], 0.5), 1));
        gr.addColorStop(0.5, rgba(M.rgb, 1));
        gr.addColorStop(1, rgba(mix(M.rgb, [5, 8, 16], 0.8), 1));
        fill = gr;
      } else {
        fill = rgba(M.rgb, 1);
      }
      g.fillStyle = fill;
      g.beginPath();
      g.arc(sx, sy, core, 0, Math.PI * 2);
      g.fill();
    }

    if (this.P.names) {
      const many = nb.nm > 40;
      for (let i = 0; i < nb.nm; i++) {
        if (many && i !== this.sel) continue;
        const sx = pos[i * 3], sy = pos[i * 3 + 1], core = pos[i * 3 + 2];
        label(g, this.meta[i].name, sx + core + 7, sy - core - 3, 'rgba(232,236,244,0.75)', LABEL_FONT);
      }
    }
  }

  private lightDir(i: number, sx: number, sy: number): [number, number] {
    const cam = this.app.camera, nb = this.nb;
    let best = -1, bestF = 0;
    for (let j = 0; j < nb.nm; j++) {
      if (j === i || this.meta[j].kind !== 'star') continue;
      const f = nb.m[j] / ((nb.x[j] - nb.x[i]) ** 2 + (nb.y[j] - nb.y[i]) ** 2 + 1e-12);
      if (f > bestF) {
        bestF = f;
        best = j;
      }
    }
    if (best < 0) return [-0.5, -0.5];
    const dx = cam.sx(nb.x[best]) - sx, dy = cam.sy(nb.y[best]) - sy;
    const d = Math.hypot(dx, dy) || 1;
    return [dx / d, dy / d];
  }

  private drawVectors(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, nb = this.nb;
    nb.ensureAcc();
    let vmax = 0, amax = 0;
    for (let i = 0; i < nb.nm; i++) {
      vmax = Math.max(vmax, Math.hypot(nb.vx[i], nb.vy[i]));
      amax = Math.max(amax, Math.hypot(nb.ax[i], nb.ay[i]));
    }
    for (let i = 0; i < nb.nm; i++) {
      const sx = cam.sx(nb.x[i]), sy = cam.sy(nb.y[i]);
      const core = this.coreSize(i) + 3;
      if (this.P.vel && vmax > 0) {
        const v = Math.hypot(nb.vx[i], nb.vy[i]);
        // vetores desprezíveis (ex.: o bamboleio do Sol) não são desenhados
        if (v / vmax > 0.02) {
          const L = 8 + 62 * Math.pow(v / vmax, 0.6);
          const ux = nb.vx[i] / v, uy = -nb.vy[i] / v;
          arrow(g, sx + ux * core, sy + uy * core, sx + ux * (core + L), sy + uy * (core + L), rgba(VEL, 0.95));
        }
      }
      if (this.P.acc && amax > 0) {
        const a = Math.hypot(nb.ax[i], nb.ay[i]);
        if (a / amax > 0.005) {
          const L = 8 + 62 * Math.pow(a / amax, 0.4);
          const ux = nb.ax[i] / a, uy = -nb.ay[i] / a;
          arrow(g, sx + ux * core, sy + uy * core, sx + ux * (core + L), sy + uy * (core + L), rgba(ACC, 0.95));
        }
      }
    }
  }

  private drawSelection(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, nb = this.nb, i = this.sel;
    const sx = cam.sx(nb.x[i]), sy = cam.sy(nb.y[i]);
    const core = this.coreSize(i);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280);
    if (this.el) {
      const j = this.el.j;
      g.setLineDash([2, 4]);
      g.strokeStyle = 'rgba(232,236,244,0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(cam.sx(nb.x[j]), cam.sy(nb.y[j]));
      g.stroke();
      g.setLineDash([]);
    }
    g.strokeStyle = rgba(ACCENT, 0.55 + 0.4 * pulse);
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sx, sy, core + 7 + pulse * 2, 0, Math.PI * 2);
    g.stroke();
  }

  private drawConic(g: CanvasRenderingContext2D, el: Elements) {
    const cam = this.app.camera, nb = this.nb;
    const fx = nb.x[el.j], fy = nb.y[el.j];
    const ang = Math.atan2(el.ey, el.ex);
    const c = Math.cos(ang), s = Math.sin(ang);
    const rgb = this.meta[this.sel].rgb;
    g.save();
    g.setLineDash([5, 6]);
    g.lineWidth = 1.2;
    g.strokeStyle = rgba(rgb, 0.5);
    if (el.e < 1 && el.a > 0) {
      const b = el.a * Math.sqrt(1 - el.e * el.e);
      const cx = fx - el.a * el.e * c, cy = fy - el.a * el.e * s;
      g.beginPath();
      g.ellipse(cam.sx(cx), cam.sy(cy), el.a * cam.zoom, b * cam.zoom, -ang, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      if (el.e > 0.02) {
        const solar = this.meta[el.j].name === 'Sol';
        const apsides: [number, string][] = [
          [el.a * (1 - el.e), solar ? 'periélio' : 'pericentro'],
          [-el.a * (1 + el.e), solar ? 'afélio' : 'apocentro'],
        ];
        for (const [d, name] of apsides) {
          const px = cam.sx(fx + d * c), py = cam.sy(fy + d * s);
          g.fillStyle = rgba(rgb, 0.9);
          g.beginPath();
          g.arc(px, py, 2.5, 0, Math.PI * 2);
          g.fill();
          label(g, name, px + 6, py + 10, 'rgba(232,236,244,0.55)', LABEL_FONT);
        }
      }
    } else {
      const nuMax = Math.acos(Math.max(-1, -1 / el.e)) * 0.97;
      g.beginPath();
      for (let k = 0; k <= 160; k++) {
        const nu = -nuMax + (2 * nuMax * k) / 160;
        const r = el.p / (1 + el.e * Math.cos(nu));
        const px = cam.sx(fx + r * Math.cos(nu + ang)), py = cam.sy(fy + r * Math.sin(nu + ang));
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }

  private drawKepler(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, nb = this.nb;
    const T = this.kepT, X = this.kepX, Y = this.kepY, len = T.length;
    const j = this.kepJ;
    if (this.kepDelta <= 0 || len < 2 || j < 0 || j >= nb.nm) return;
    const fsx = cam.sx(nb.x[j]), fsy = cam.sy(nb.y[j]), z = cam.zoom;
    const sector = (k: number) => Math.floor((T[k] - this.kepT0) / this.kepDelta);
    const areas: number[] = [];
    let start = 0;
    while (start < len) {
      const s = sector(start);
      let end = start;
      while (end + 1 < len && sector(end + 1) === s) end++;
      const close = end + 1 < len ? end + 1 : end;
      const even = s % 2 === 0;
      g.beginPath();
      g.moveTo(fsx, fsy);
      for (let k = start; k <= close; k++) g.lineTo(fsx + X[k] * z, fsy - Y[k] * z);
      g.closePath();
      g.fillStyle = even ? 'rgba(255,181,71,0.2)' : 'rgba(90,176,255,0.17)';
      g.fill();
      g.strokeStyle = even ? 'rgba(255,181,71,0.45)' : 'rgba(90,176,255,0.4)';
      g.lineWidth = 0.8;
      g.stroke();
      if (end + 1 < len) {
        let A = 0;
        for (let k = start; k < close; k++) A += X[k] * Y[k + 1] - X[k + 1] * Y[k];
        areas.push(Math.abs(A) / 2);
      }
      start = end + 1;
    }
    this.kepAreas = areas;
  }

  private drawEffects(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, now = performance.now();
    this.effects = this.effects.filter((f) => now - f.t0 < 900);
    for (const f of this.effects) {
      const a = (now - f.t0) / 900;
      const sx = cam.sx(f.x), sy = cam.sy(f.y);
      g.globalCompositeOperation = 'lighter';
      const s = 70 * (1 - a) + 10;
      g.drawImage(glowSprite(f.rgb, 'halo'), sx - s, sy - s, s * 2, s * 2);
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = rgba(f.rgb, 0.9 * (1 - a));
      g.lineWidth = 2 * (1 - a) + 0.5;
      g.beginPath();
      g.arc(sx, sy, 6 + a * 60, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawDrag(g: CanvasRenderingContext2D) {
    const d = this.drag!;
    const cam = this.app.camera;
    const sx0 = cam.sx(d.wx0), sy0 = cam.sy(d.wy0);
    g.strokeStyle = rgba(ACCENT, 0.9);
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sx0, sy0, 5, 0, Math.PI * 2);
    g.stroke();
    if (!d.moved) return;

    const pv = this.preview;
    if (pv && pv.count > 1) {
      const chunks = 12, per = Math.ceil(pv.count / chunks), P = pv.path;
      g.setLineDash([2, 5]);
      g.lineWidth = 1.6;
      for (let c = 0; c < chunks; c++) {
        const s = c * per, e = Math.min(pv.count - 1, (c + 1) * per);
        if (s >= e) continue;
        g.strokeStyle = rgba(ACCENT, 0.9 * Math.pow(1 - c / chunks, 1.3) + 0.08);
        g.beginPath();
        g.moveTo(cam.sx(P[s * 2]), cam.sy(P[s * 2 + 1]));
        for (let k = s + 1; k <= e; k++) g.lineTo(cam.sx(P[k * 2]), cam.sy(P[k * 2 + 1]));
        g.stroke();
      }
      g.setLineDash([]);
      if (pv.hit) {
        const ex = cam.sx(P[(pv.count - 1) * 2]), ey = cam.sy(P[(pv.count - 1) * 2 + 1]);
        g.strokeStyle = rgba(ACC, 0.95);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(ex - 6, ey - 6); g.lineTo(ex + 6, ey + 6);
        g.moveTo(ex + 6, ey - 6); g.lineTo(ex - 6, ey + 6);
        g.stroke();
      }
    }
    arrow(g, sx0, sy0, d.sx, d.sy, rgba(ACCENT, 0.95), 2, 9);
    const v = this.launchVel(d);
    label(g, `${num(v.vrel * KMS, 1)} km/s`, d.sx + 12, d.sy - 12, 'rgba(255,220,160,0.95)', '500 12px "JetBrains Mono", monospace');
  }
}
