import type {
  ChartDef, ParamDef, ParamValue, PointerInfo, ReadoutDef, SimContext, Simulation, ToolDef,
} from '../../core/types';
import { arrow, label } from '../../core/render/draw';
import { glowSprite, hexToRgb, rgba, type RGB } from '../../core/render/glow';
import { Trail } from '../../core/render/trail';
import { niceStep, num, sci, sig } from '../../core/units';
import { icons } from '../../ui/icons';
import { FieldMap, MAX_CHARGES } from './fieldmap';
import {
  CHARGE_R, C_LIGHT, K, NC, PARTICLES, Particle, QE, field, systemEnergy, type Charge, type FieldSample,
} from './physics';
import { PRESETS, buildScene, type Beam } from './presets';

const POS: RGB = [255, 90, 110];
const NEG: RGB = [80, 140, 255];
const ACCENT: RGB = [90, 176, 255];
const MONO_FONT = '500 11px "JetBrains Mono", ui-monospace, monospace';
const MAX_PARTICLES = 400;
const MODES = ['potencial', 'campo', 'nenhum'];

interface Line {
  pts: Float64Array;
  n: number;
}

interface Tracked {
  p: Particle;
  trail: Trail;
  rgb: RGB;
  died: number;
}

type Drag =
  | { kind: 'charge'; idx: number; moved: boolean }
  | { kind: 'probe' }
  | { kind: 'launch'; x0: number; y0: number; x: number; y: number; moved: boolean };

function fmtTime(t: number): string {
  const a = Math.abs(t);
  if (a < 1e-6) return `${num(t * 1e9, 2)} ns`;
  if (a < 1e-3) return `${num(t * 1e6, 3)} µs`;
  return `${num(t * 1e3, 3)} ms`;
}

function fmtEV(e: number): string {
  const a = Math.abs(e);
  if (a >= 1e6) return `${sig(e / 1e6, 4)} MeV`;
  if (a >= 1e3) return `${sig(e / 1e3, 4)} keV`;
  return `${sig(e, 4)} eV`;
}

function fmtLen(m: number): string {
  return m >= 0.01 ? `${sig(m * 100, 3)} cm` : `${sig(m * 1000, 3)} mm`;
}

/** Velocidade relativística para uma energia cinética E (J). */
function speedFor(E: number, m: number): number {
  const g = 1 + E / (m * C_LIGHT * C_LIGHT);
  return C_LIGHT * Math.sqrt(1 - 1 / (g * g));
}

export default class CampoEletrico implements Simulation {
  readonly presets = PRESETS;
  readonly time = { dt: 1e-11, scale: 4e-9 };
  readonly hint =
    '<b>Arraste</b> as cargas · use as <b>ferramentas</b> para criar cargas, lançar partículas (arraste para dar velocidade) e medir o campo com a sonda · <kbd>1</kbd>–<kbd>5</kbd> trocam de ferramenta';
  currentPreset = 'dipolo';
  tool = 'pos';

  readonly tools: ToolDef[] = [
    { id: 'pos', label: 'Carga positiva', icon: icons.plus, hint: 'Clique para criar uma carga +q; arraste cargas para movê-las' },
    { id: 'neg', label: 'Carga negativa', icon: icons.minus, hint: 'Clique para criar uma carga −q' },
    { id: 'particula', label: 'Lançar partícula', icon: icons.particle, hint: 'Arraste para lançar; clique para soltar do repouso' },
    { id: 'sonda', label: 'Sonda', icon: icons.probe, hint: 'Clique para medir E e V num ponto' },
    { id: 'apagar', label: 'Apagar', icon: icons.eraser, hint: 'Clique numa carga para removê-la' },
  ];

  private app!: SimContext;
  private map: FieldMap | null = null;
  private charges: Charge[] = [];
  private lines: Line[] = [];
  private linesDirty = true;
  private parts: Tracked[] = [];
  private tracked: Tracked | null = null;
  private sel = -1;
  private probe: [number, number] | null = null;
  private drag: Drag | null = null;
  private beam: Beam | null = null;
  private beamAcc = 0;
  private t = 0;
  private bound = 0.4;
  private f: FieldSample = { ex: 0, ey: 0, v: 0, rmin: 0 };
  private scales = { dV: 100, vS: 500, eS: 1e4, vTyp: 1000 };
  private frameN = 0;
  private preview: Float64Array | null = null;
  private previewN = 0;
  private previewDirty = false;
  private lastScatter: { b: number; theta: number; E: number } | null = null;
  private rng = Math.random;

  private P = {
    q: 5, particle: 'proton', beam: false, map: 'potencial', equi: true, lines: true, flow: true, density: 3, grid: false,
  };

  readonly params: ParamDef[] = [
    {
      type: 'range', key: 'q', label: 'Carga |q|', group: 'Cargas', min: 0.5, max: 20, step: 0.5, value: 5,
      format: (v) => `${num(v, 1)} nC`, hint: 'Vale para as novas cargas e para a carga selecionada.',
    },
    { type: 'action', key: 'clearC', label: 'Remover todas as cargas', group: 'Cargas' },
    {
      type: 'select', key: 'particle', label: 'Tipo de partícula', group: 'Partículas', value: 'proton',
      options: [
        { value: 'eletron', label: 'Elétron' },
        { value: 'proton', label: 'Próton' },
        { value: 'alfa', label: 'Alfa' },
      ],
    },
    { type: 'toggle', key: 'beam', label: 'Feixe contínuo', group: 'Partículas', value: false },
    { type: 'action', key: 'clearP', label: 'Remover partículas', group: 'Partículas' },
    {
      type: 'select', key: 'map', label: 'Mapa de cores', group: 'Visualização', value: 'potencial',
      options: [
        { value: 'potencial', label: 'Potencial' },
        { value: 'campo', label: '|E|' },
        { value: 'nenhum', label: 'Nenhum' },
      ],
    },
    { type: 'toggle', key: 'equi', label: 'Equipotenciais', group: 'Visualização', value: true },
    { type: 'toggle', key: 'lines', label: 'Linhas de campo', group: 'Visualização', value: true },
    { type: 'toggle', key: 'flow', label: 'Animar o sentido do campo', group: 'Visualização', value: true },
    {
      type: 'range', key: 'density', label: 'Linhas por nC', group: 'Visualização', min: 1, max: 8, step: 1, value: 3,
      format: (v) => num(v, 0), hint: 'O número de linhas que sai de cada carga é proporcional a |q| (lei de Gauss).',
    },
    { type: 'toggle', key: 'grid', label: 'Vetores em grade', group: 'Visualização', value: false },
  ];

  readonly readouts: ReadoutDef[] = [
    {
      key: 'n', group: 'Sistema', label: 'Cargas',
      get: () => `${this.charges.length} · Q = ${sig(this.charges.reduce((s, c) => s + c.q, 0) / NC, 3)} nC`,
    },
    {
      key: 'U', group: 'Sistema', label: 'Energia potencial',
      hint: 'U = Σ k·qᵢ·qⱼ / rᵢⱼ: trabalho para montar a configuração trazendo as cargas do infinito.',
      get: () => `${sci(systemEnergy(this.charges))} J`,
    },
    { key: 'dV', group: 'Sistema', label: 'ΔV entre equipotenciais', get: () => `${sig(this.scales.dV, 2)} V` },
    { key: 'np', group: 'Sistema', label: 'Partículas', get: () => `${this.parts.filter((p) => p.p.alive).length}` },

    { key: 'pV', group: 'Sonda', label: 'Potencial V', visible: () => !!this.probe, get: () => `${sci(this.probeField().v, 4)} V` },
    {
      key: 'pE', group: 'Sonda', label: 'Campo |E|', visible: () => !!this.probe,
      get: () => `${sci(Math.hypot(this.probeField().ex, this.probeField().ey), 4)} V/m`,
    },
    {
      key: 'pA', group: 'Sonda', label: 'Direção de E', visible: () => !!this.probe,
      get: () => `${num((Math.atan2(this.probeField().ey, this.probeField().ex) * 180) / Math.PI, 1)}°`,
    },
    {
      key: 'pF', group: 'Sonda', label: 'Força em +1 nC', visible: () => !!this.probe,
      get: () => `${sci(Math.hypot(this.probeField().ex, this.probeField().ey) * NC, 3)} N`,
    },
    {
      key: 'pQ', group: 'Sonda', label: 'Carga inferida |E|·r²/k', visible: () => !!this.probe && this.currentPreset === 'unica' && this.charges.length === 1,
      hint: 'Pela lei de Coulomb, |E|·r²/k deve dar a própria carga, em qualquer ponto.',
      get: () => {
        const c = this.charges[0], f = this.probeField();
        const r2 = (this.probe![0] - c.x) ** 2 + (this.probe![1] - c.y) ** 2;
        return `${sig((Math.hypot(f.ex, f.ey) * r2) / K / NC, 4)} nC`;
      },
    },

    { key: 'sq', group: 'Carga selecionada', label: 'Carga q', visible: () => this.sel >= 0, get: () => `${sig(this.charges[this.sel].q / NC, 3)} nC` },
    {
      key: 'sF', group: 'Carga selecionada', label: 'Força das outras cargas', visible: () => this.sel >= 0,
      hint: 'F = q·E dos demais — superposição da lei de Coulomb.',
      get: () => {
        const F = this.forceOnSel();
        return `${sci(Math.hypot(F[0], F[1]), 3)} N`;
      },
    },

    { key: 'tt', group: 'Partícula acompanhada', label: 'Tipo', visible: () => !!this.tracked, get: () => this.tracked!.p.type.name },
    { key: 'tK', group: 'Partícula acompanhada', label: 'Energia cinética', visible: () => !!this.tracked, get: () => fmtEV(this.tracked!.p.kinetic() / QE) },
    {
      key: 'tv', group: 'Partícula acompanhada', label: 'Velocidade v/c', visible: () => !!this.tracked,
      hint: 'A dinâmica é relativística: p = γmv.',
      get: () => num(this.tracked!.p.speed() / C_LIGHT, 4),
    },

    { key: 'rb', group: 'Rutherford', label: 'Parâmetro de impacto b', visible: () => this.currentPreset === 'rutherford' && !!this.lastScatter, get: () => fmtLen(Math.abs(this.lastScatter!.b)) },
    {
      key: 'rm', group: 'Rutherford', label: 'Desvio θ medido', visible: () => this.currentPreset === 'rutherford' && !!this.lastScatter,
      get: () => `${num(this.lastScatter!.theta, 1)}°`,
    },
    {
      key: 'rt', group: 'Rutherford', label: 'θ teórico = 2·arctan(d₀/2b)', visible: () => this.currentPreset === 'rutherford' && !!this.lastScatter,
      hint: 'd₀ = k·q·Q/E é a distância de máxima aproximação numa colisão frontal.',
      get: () => {
        const s = this.lastScatter!;
        const Q = this.charges[0]?.q ?? 0;
        const d0 = (K * PARTICLES.alfa.q * Q) / (s.E * QE);
        return `${num((2 * Math.atan(d0 / (2 * Math.abs(s.b))) * 180) / Math.PI, 1)}°`;
      },
    },
  ];

  readonly charts: ChartDef[] = [
    {
      title: 'Energia da partícula acompanhada',
      format: (v) => fmtEV(v),
      series: [
        { label: 'Cinética K', color: '#ff7a8a', get: () => (this.tracked ? this.tracked.p.kinetic() / QE : NaN) },
        { label: 'Potencial U = qV', color: '#5ab0ff', get: () => (this.tracked ? this.tracked.p.potential(this.charges) / QE : NaN) },
        {
          label: 'Total E = K + U', color: '#f4f4f4',
          get: () => (this.tracked ? (this.tracked.p.kinetic() + this.tracked.p.potential(this.charges)) / QE : NaN),
        },
      ],
    },
  ];

  private probeField() {
    return field(this.charges, this.probe![0], this.probe![1], this.f);
  }

  private forceOnSel(): [number, number] {
    const c = this.charges[this.sel];
    const others = this.charges.filter((_, i) => i !== this.sel);
    const f = field(others, c.x, c.y, this.f);
    return [c.q * f.ex, c.q * f.ey];
  }

  // ───────────────────────── ciclo de vida ─────────────────────────

  init(ctx: SimContext) {
    this.app = ctx;
    ctx.stage.drawBackground = (g, w, h) => {
      g.fillStyle = '#070910';
      g.fillRect(0, 0, w, h);
    };
    ctx.stage.paintBackground();
    const gl = ctx.stage.enableGL();
    try {
      if (gl) this.map = new FieldMap(gl);
    } catch (e) {
      console.warn(e);
      this.map = null;
    }
    this.loadPreset(this.currentPreset);
  }

  dispose() {
    this.map?.dispose();
    this.app.stage.drawBackground = null;
  }

  onTool(id: string) {
    this.tool = id;
  }

  private setParam(key: string, value: ParamValue) {
    (this.P as Record<string, ParamValue>)[key] = value;
    const def = this.params.find((p) => p.key === key);
    if (def && def.type !== 'action') def.value = value as never;
  }

  loadPreset(id: string) {
    const sc = buildScene(id);
    this.currentPreset = id;
    this.charges = sc.charges.map((c) => ({ ...c }));
    this.probe = sc.probe;
    this.parts = [];
    this.tracked = null;
    this.sel = -1;
    this.t = 0;
    this.beamAcc = 0;
    this.lastScatter = null;
    this.linesDirty = true;
    this.preview = null;
    this.bound = Math.max(0.3, sc.halfHeight * 4);
    this.app.camera.fit(sc.cx ?? 0, 0, sc.halfHeight, true);
    this.setParam('density', sc.density ?? 3);
    this.setParam('particle', sc.particle);
    this.setParam('beam', !!sc.beam);
    this.beam = sc.beam ?? null;
    this.sampleScales();
    this.retime();
    this.app.resetCharts();
    this.app.refreshUI();
  }

  /** Feixe padrão para cenários sem feixe próprio. */
  private defaultBeam(): Beam {
    const h = this.app.camera.halfHeight();
    const type = PARTICLES[this.P.particle];
    return { type: type.id, energy: Math.abs(type.q) * this.scales.vTyp / QE, x: -h * 1.5, y0: -h * 0.5, y1: h * 0.5 };
  }

  /** Escala de tempo: uma partícula típica cruza a tela em ~4 s. */
  private retime() {
    const type = PARTICLES[this.beam?.type ?? this.P.particle];
    const E = this.beam ? this.beam.energy * QE : Math.abs(type.q) * this.scales.vTyp;
    const v = speedFor(Math.max(E, QE), type.m);
    const span = 2 * this.app.camera.halfHeight() * (this.app.camera.w / Math.max(1, this.app.camera.h));
    this.time.scale = span / v / 4;
    this.time.dt = this.time.scale / 400;
  }

  onParam(key: string, value: ParamValue) {
    (this.P as Record<string, ParamValue>)[key] = value;
    switch (key) {
      case 'q':
        if (this.sel >= 0) {
          const c = this.charges[this.sel];
          c.q = Math.sign(c.q) * (value as number) * NC;
          this.linesDirty = true;
        }
        break;
      case 'clearC':
        this.charges = [];
        this.sel = -1;
        this.linesDirty = true;
        break;
      case 'clearP':
        this.parts = [];
        this.tracked = null;
        this.app.resetCharts();
        break;
      case 'particle':
        if (this.beam && this.beam.type !== value) this.beam = null;
        if (this.P.beam && !this.beam) this.beam = this.defaultBeam();
        this.retime();
        this.app.refreshUI();
        break;
      case 'beam':
        if (value && !this.beam) this.beam = this.defaultBeam();
        this.beamAcc = 0;
        break;
      case 'density':
        this.linesDirty = true;
        break;
    }
  }

  // ───────────────────────── física ─────────────────────────

  step(dt: number) {
    this.t += dt;
    if (this.P.beam && this.beam) {
      this.beamAcc += dt;
      const interval = this.time.scale * 0.12;
      while (this.beamAcc >= interval) {
        this.beamAcc -= interval;
        this.emit(this.beam);
      }
    }
    const now = performance.now();
    for (const tp of this.parts) {
      if (!tp.p.alive) continue;
      tp.p.advance(this.charges, dt, this.bound);
      tp.trail.push(tp.p.x, tp.p.y, (1.5 / this.app.camera.zoom) ** 2);
      if (!tp.p.alive) {
        tp.died = now;
        this.onDeath(tp);
      }
    }
  }

  private onDeath(tp: Tracked) {
    const p = tp.p;
    // saiu da região (não foi capturada): mede o desvio final
    if (Number.isFinite(p.b) && Math.hypot(p.x, p.y) > this.bound * 0.9) {
      const [vx, vy] = p.vel();
      let d = Math.abs(Math.atan2(vy, vx) - p.dir0);
      if (d > Math.PI) d = 2 * Math.PI - d;
      const E0 = (this.beam?.energy ?? 0);
      this.lastScatter = { b: p.b, theta: (d * 180) / Math.PI, E: E0 };
    }
  }

  private addParticle(p: Particle, track: boolean) {
    const tp: Tracked = { p, trail: new Trail(500), rgb: hexToRgb(p.type.color), died: 0 };
    this.parts.push(tp);
    if (this.parts.length > MAX_PARTICLES) this.parts.shift();
    if (track || !this.tracked || !this.tracked.p.alive) {
      this.tracked = tp;
      this.app.resetCharts();
    }
  }

  private emit(b: Beam) {
    const type = PARTICLES[b.type];
    const v = speedFor(b.energy * QE, type.m);
    const y = b.y0 + (b.y1 - b.y0) * this.rng();
    const target = this.charges[0]?.y ?? 0;
    this.addParticle(new Particle(b.x, y, v, 0, type, y - target), false);
  }

  clock() {
    return `t = ${fmtTime(this.t)}`;
  }

  speedLabel(mult: number) {
    return `${fmtTime(this.time.scale * mult)}/s`;
  }

  // ───────────────────────── linhas de campo ─────────────────────────

  private nearest(x: number, y: number): number {
    let best = -1, bd = Infinity;
    this.charges.forEach((c, i) => {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Linhas de campo por RK4 com passo proporcional à distância à carga mais próxima. */
  private traceLines() {
    this.linesDirty = false;
    this.lines = [];
    const ch = this.charges;
    if (!ch.length) return;
    let pos = 0, neg = 0, cx = 0, cy = 0;
    for (const c of ch) {
      if (c.q > 0) pos += c.q;
      else neg -= c.q;
      cx += c.x / ch.length;
      cy += c.y / ch.length;
    }
    let ext = 0.05;
    for (const c of ch) ext = Math.max(ext, Math.hypot(c.x - cx, c.y - cy));
    const R = ext * 4 + 0.1;
    const sgn = pos >= neg ? 1 : -1;
    const f = this.f;
    const dir = (x: number, y: number): [number, number] => {
      field(ch, x, y, f);
      const m = Math.hypot(f.ex, f.ey) || 1;
      return [(sgn * f.ex) / m, (sgn * f.ey) / m];
    };

    for (const c of ch) {
      if (Math.sign(c.q) !== sgn) continue;
      const n = Math.max(2, Math.round((this.P.density * Math.abs(c.q)) / NC));
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * Math.PI * 2;
        const pts: number[] = [c.x, c.y];
        let x = c.x + CHARGE_R * 1.02 * Math.cos(a), y = c.y + CHARGE_R * 1.02 * Math.sin(a);
        pts.push(x, y);
        for (let s = 0; s < 1200; s++) {
          field(ch, x, y, f);
          const h = Math.min(R * 0.012, Math.max(R * 0.0006, f.rmin * 0.12));
          const k1 = dir(x, y);
          const k2 = dir(x + (k1[0] * h) / 2, y + (k1[1] * h) / 2);
          const k3 = dir(x + (k2[0] * h) / 2, y + (k2[1] * h) / 2);
          const k4 = dir(x + k3[0] * h, y + k3[1] * h);
          x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
          y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
          pts.push(x, y);
          const j = this.nearest(x, y);
          const cj = ch[j];
          if (Math.hypot(cj.x - x, cj.y - y) < CHARGE_R && Math.sign(cj.q) !== sgn) {
            pts.push(cj.x, cj.y);
            break;
          }
          if (Math.hypot(x - cx, y - cy) > R) break;
        }
        // orienta todas as linhas no sentido de E (da carga + para a −)
        if (sgn < 0) {
          const rev: number[] = [];
          for (let i = pts.length - 2; i >= 0; i -= 2) rev.push(pts[i], pts[i + 1]);
          this.lines.push({ pts: Float64Array.from(rev), n: rev.length / 2 });
        } else {
          this.lines.push({ pts: Float64Array.from(pts), n: pts.length / 2 });
        }
      }
    }
  }

  /** Escalas automáticas (ΔV das equipotenciais, cores) a partir de amostras da vista. */
  private sampleScales() {
    const cam = this.app.camera;
    if (!this.charges.length) return;
    const Vs: number[] = [], Es: number[] = [];
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 14; j++) {
        const w = cam.toWorld((cam.w * (i + 0.5)) / 24, (cam.h * (j + 0.5)) / 14);
        field(this.charges, w.x, w.y, this.f);
        Vs.push(Math.abs(this.f.v));
        Es.push(Math.hypot(this.f.ex, this.f.ey));
      }
    }
    Vs.sort((a, b) => a - b);
    Es.sort((a, b) => a - b);
    const v80 = Math.max(1e-6, Vs[Math.floor(Vs.length * 0.8)]);
    this.scales = { dV: niceStep(v80 / 8), vS: v80, eS: Math.max(1e-6, Es[Es.length >> 1]), vTyp: v80 };
  }

  // ───────────────────────── interação ─────────────────────────

  private chargePx(c: Charge) {
    return 6 + 5 * Math.min(1.4, Math.sqrt(Math.abs(c.q) / (5 * NC)));
  }

  private hitCharge(sx: number, sy: number): number {
    const cam = this.app.camera;
    let best = -1, bd = Infinity;
    this.charges.forEach((c, i) => {
      const d = Math.hypot(cam.sx(c.x) - sx, cam.sy(c.y) - sy);
      if (d < Math.max(12, this.chargePx(c) + 4) && d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private launchVel(d: { x0: number; y0: number; x: number; y: number; moved: boolean }): [number, number] {
    if (!d.moved) return [0, 0];
    const type = PARTICLES[this.P.particle];
    const vTyp = speedFor(Math.abs(type.q) * this.scales.vTyp, type.m);
    const k = vTyp / (0.5 * this.app.camera.halfHeight());
    let vx = (d.x - d.x0) * k, vy = (d.y - d.y0) * k;
    const v = Math.hypot(vx, vy);
    if (v > 0.95 * C_LIGHT) {
      vx *= (0.95 * C_LIGHT) / v;
      vy *= (0.95 * C_LIGHT) / v;
    }
    return [vx, vy];
  }

  onPointer(p: PointerInfo) {
    const cam = this.app.camera;
    switch (p.kind) {
      case 'hover':
        this.app.stage.canvas.style.cursor = this.hitCharge(p.sx, p.sy) >= 0 ? (this.tool === 'apagar' ? 'pointer' : 'grab') : 'crosshair';
        break;
      case 'down': {
        const ci = this.hitCharge(p.sx, p.sy);
        if (ci >= 0) {
          if (this.tool === 'apagar') {
            this.charges.splice(ci, 1);
            this.sel = -1;
            this.linesDirty = true;
          } else {
            this.sel = ci;
            this.setParam('q', Math.abs(this.charges[ci].q) / NC);
            this.app.refreshUI();
            this.drag = { kind: 'charge', idx: ci, moved: false };
          }
          return;
        }
        if (this.probe && Math.hypot(cam.sx(this.probe[0]) - p.sx, cam.sy(this.probe[1]) - p.sy) < 12) {
          this.drag = { kind: 'probe' };
          return;
        }
        if (this.tool === 'pos' || this.tool === 'neg') {
          if (this.charges.length >= MAX_CHARGES) {
            this.app.toast(`Máximo de ${MAX_CHARGES} cargas`);
            return;
          }
          this.charges.push({ x: p.wx, y: p.wy, q: (this.tool === 'pos' ? 1 : -1) * this.P.q * NC });
          this.sel = this.charges.length - 1;
          this.linesDirty = true;
          this.drag = { kind: 'charge', idx: this.sel, moved: false };
        } else if (this.tool === 'particula') {
          this.drag = { kind: 'launch', x0: p.wx, y0: p.wy, x: p.wx, y: p.wy, moved: false };
        } else if (this.tool === 'sonda') {
          this.probe = [p.wx, p.wy];
          this.drag = { kind: 'probe' };
        } else {
          this.sel = -1;
        }
        break;
      }
      case 'move': {
        const d = this.drag;
        if (!d) break;
        if (d.kind === 'charge') {
          const c = this.charges[d.idx];
          if (c) {
            c.x = p.wx;
            c.y = p.wy;
            d.moved = true;
            this.linesDirty = true;
          }
        } else if (d.kind === 'probe') {
          this.probe = [p.wx, p.wy];
        } else {
          d.x = p.wx;
          d.y = p.wy;
          if (Math.hypot(cam.sx(d.x) - cam.sx(d.x0), cam.sy(d.y) - cam.sy(d.y0)) > 6) d.moved = true;
          this.previewDirty = true;
        }
        break;
      }
      case 'up': {
        const d = this.drag;
        if (d?.kind === 'launch') {
          const [vx, vy] = this.launchVel(d);
          this.addParticle(new Particle(d.x0, d.y0, vx, vy, PARTICLES[this.P.particle]), true);
        }
        if (d?.kind === 'charge' && d.moved) this.sampleScales();
        this.drag = null;
        this.preview = null;
        break;
      }
      case 'cancel':
        this.drag = null;
        this.preview = null;
        break;
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.sel >= 0) {
      this.sel = -1;
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) {
      this.charges.splice(this.sel, 1);
      this.sel = -1;
      this.linesDirty = true;
      return true;
    }
    return false;
  }

  private predict(d: { x0: number; y0: number; x: number; y: number; moved: boolean }) {
    const [vx, vy] = this.launchVel(d);
    const p = new Particle(d.x0, d.y0, vx, vy, PARTICLES[this.P.particle]);
    const steps = 360;
    const h = (this.time.scale * 5) / steps;
    const out = new Float64Array((steps + 1) * 2);
    out[0] = p.x;
    out[1] = p.y;
    let n = 1;
    for (let s = 0; s < steps && p.alive; s++) {
      p.advance(this.charges, h, this.bound);
      out[n * 2] = p.x;
      out[n * 2 + 1] = p.y;
      n++;
    }
    this.preview = out;
    this.previewN = n;
  }

  // ───────────────────────── renderização ─────────────────────────

  render() {
    const stage = this.app.stage, cam = this.app.camera;
    if (this.linesDirty) this.traceLines();
    this.frameN++;
    if (this.frameN % 10 === 0 && this.drag?.kind !== 'charge') this.sampleScales();
    if (this.drag?.kind === 'launch' && this.drag.moved && this.previewDirty) {
      this.predict(this.drag);
      this.previewDirty = false;
    }

    if (this.map) {
      this.map.render(this.charges, cam, stage.dpr, MODES.indexOf(this.P.map), this.scales.dV, this.scales.vS, this.scales.eS, this.P.equi);
    }

    stage.begin();
    const g = stage.ctx;
    if (this.P.grid) this.drawGrid(g);
    if (this.P.lines) this.drawLines(g);
    this.drawParticles(g);
    this.drawCharges(g);
    if (this.probe) this.drawProbe(g);
    if (this.drag?.kind === 'launch') this.drawLaunch(g);
    this.drawScale(g);
  }

  private drawLines(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const path = new Path2D();
    const heads: [number, number, number, number][] = [];
    for (const L of this.lines) {
      const P = L.pts;
      path.moveTo(cam.sx(P[0]), cam.sy(P[1]));
      for (let i = 1; i < L.n; i++) path.lineTo(cam.sx(P[i * 2]), cam.sy(P[i * 2 + 1]));
      const m = L.n >> 1;
      if (L.n > 6) heads.push([cam.sx(P[m * 2]), cam.sy(P[m * 2 + 1]), cam.sx(P[m * 2 + 2]), cam.sy(P[m * 2 + 3])]);
    }
    g.lineWidth = 1.1;
    g.strokeStyle = 'rgba(220,232,255,0.26)';
    g.stroke(path);
    if (this.P.flow) {
      g.globalCompositeOperation = 'lighter';
      g.setLineDash([2.5, 13]);
      g.lineDashOffset = -(performance.now() / 1000) * 26;
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(190,220,255,0.7)';
      g.stroke(path);
      g.setLineDash([]);
      g.globalCompositeOperation = 'source-over';
    }
    g.fillStyle = 'rgba(230,240,255,0.75)';
    for (const [x0, y0, x1, y1] of heads) {
      const a = Math.atan2(y1 - y0, x1 - x0);
      g.beginPath();
      g.moveTo(x0 + Math.cos(a) * 5, y0 + Math.sin(a) * 5);
      g.lineTo(x0 + Math.cos(a + 2.5) * 5, y0 + Math.sin(a + 2.5) * 5);
      g.lineTo(x0 + Math.cos(a - 2.5) * 5, y0 + Math.sin(a - 2.5) * 5);
      g.closePath();
      g.fill();
    }
  }

  private drawGrid(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const step = 42;
    for (let sx = step / 2; sx < cam.w; sx += step) {
      for (let sy = step / 2; sy < cam.h; sy += step) {
        const w = cam.toWorld(sx, sy);
        field(this.charges, w.x, w.y, this.f);
        if (this.f.rmin < CHARGE_R * 2) continue;
        const E = Math.hypot(this.f.ex, this.f.ey);
        if (E === 0) continue;
        const s = Math.max(0, Math.min(1, (Math.log10(E / this.scales.eS) + 1) / 2));
        const L = 6 + 14 * s;
        const ux = this.f.ex / E, uy = -this.f.ey / E;
        arrow(g, sx - ux * L * 0.5, sy - uy * L * 0.5, sx + ux * L * 0.5, sy + uy * L * 0.5, `rgba(255,255,255,${0.25 + 0.6 * s})`, 1.2, 4);
      }
    }
  }

  private drawCharges(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    this.charges.forEach((c, i) => {
      const sx = cam.sx(c.x), sy = cam.sy(c.y);
      const r = this.chargePx(c);
      const rgb = c.q > 0 ? POS : NEG;
      g.globalCompositeOperation = 'lighter';
      const hs = r * 4.5;
      g.drawImage(glowSprite(rgb, 'halo'), sx - hs, sy - hs, hs * 2, hs * 2);
      g.globalCompositeOperation = 'source-over';
      const gr = g.createRadialGradient(sx - r * 0.3, sy - r * 0.35, r * 0.1, sx, sy, r);
      gr.addColorStop(0, rgba([255, 255, 255], 0.95));
      gr.addColorStop(0.35, rgba(rgb, 1));
      gr.addColorStop(1, rgba(rgb.map((v) => v * 0.55) as RGB, 1));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = Math.max(1.5, r * 0.18);
      g.lineCap = 'round';
      const k = r * 0.45;
      g.beginPath();
      g.moveTo(sx - k, sy);
      g.lineTo(sx + k, sy);
      if (c.q > 0) {
        g.moveTo(sx, sy - k);
        g.lineTo(sx, sy + k);
      }
      g.stroke();
      if (i === this.sel) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280);
        g.strokeStyle = rgba(ACCENT, 0.55 + 0.4 * pulse);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(sx, sy, r + 6 + pulse * 2, 0, Math.PI * 2);
        g.stroke();
        label(g, `${sig(c.q / NC, 3)} nC`, sx + r + 10, sy - r - 4, 'rgba(232,236,244,0.85)', MONO_FONT);
      }
    });
  }

  private drawParticles(g: CanvasRenderingContext2D) {
    const cam = this.app.camera, now = performance.now();
    this.parts = this.parts.filter((tp) => tp.p.alive || now - tp.died < 1500);
    if (this.tracked && !this.parts.includes(this.tracked)) this.tracked = null;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const tp of this.parts) {
      const fade = tp.p.alive ? 1 : 1 - (now - tp.died) / 1500;
      const tr = tp.trail, L = tr.len;
      if (L > 1) {
        const chunks = 6, per = Math.ceil(L / chunks);
        g.lineWidth = tp === this.tracked ? 1.8 : 1.2;
        for (let c = 0; c < chunks; c++) {
          const s = c * per, e = Math.min(L - 1, (c + 1) * per);
          if (s >= e) continue;
          g.strokeStyle = rgba(tp.rgb, fade * 0.8 * ((c + 1) / chunks) ** 1.5);
          g.beginPath();
          g.moveTo(cam.sx(tr.x(s)), cam.sy(tr.y(s)));
          for (let k = s + 1; k <= e; k++) g.lineTo(cam.sx(tr.x(k)), cam.sy(tr.y(k)));
          g.stroke();
        }
      }
      if (tp.p.alive) {
        const sx = cam.sx(tp.p.x), sy = cam.sy(tp.p.y);
        g.drawImage(glowSprite(tp.rgb, 'dot'), sx - 6, sy - 6, 12, 12);
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  private drawProbe(g: CanvasRenderingContext2D) {
    const cam = this.app.camera;
    const [x, y] = this.probe!;
    const sx = cam.sx(x), sy = cam.sy(y);
    const f = this.probeField();
    const E = Math.hypot(f.ex, f.ey);
    if (E > 0) {
      const s = Math.max(0, Math.min(1.4, (Math.log10(E / this.scales.eS) + 1) / 2));
      const L = 18 + 40 * s;
      arrow(g, sx, sy, sx + (f.ex / E) * L, sy - (f.ey / E) * L, 'rgba(255,220,150,0.95)', 2, 8);
    }
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sx, sy, 6, 0, Math.PI * 2);
    g.stroke();
    label(g, `${sci(E, 3)} V/m`, sx + 12, sy + 16, 'rgba(255,220,150,0.95)', MONO_FONT);
    label(g, `${sci(f.v, 3)} V`, sx + 12, sy + 30, 'rgba(232,236,244,0.8)', MONO_FONT);
  }

  private drawLaunch(g: CanvasRenderingContext2D) {
    const d = this.drag as Extract<Drag, { kind: 'launch' }>;
    const cam = this.app.camera;
    const type = PARTICLES[this.P.particle];
    const rgb = hexToRgb(type.color);
    const sx0 = cam.sx(d.x0), sy0 = cam.sy(d.y0);
    if (this.preview && d.moved) {
      const P = this.preview;
      g.setLineDash([2, 5]);
      g.strokeStyle = rgba(rgb, 0.8);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cam.sx(P[0]), cam.sy(P[1]));
      for (let i = 1; i < this.previewN; i++) g.lineTo(cam.sx(P[i * 2]), cam.sy(P[i * 2 + 1]));
      g.stroke();
      g.setLineDash([]);
      arrow(g, sx0, sy0, cam.sx(d.x), cam.sy(d.y), rgba(rgb, 0.95), 2, 9);
      const [vx, vy] = this.launchVel(d);
      const v = Math.hypot(vx, vy);
      const gm = 1 / Math.sqrt(1 - (v * v) / (C_LIGHT * C_LIGHT));
      const K = ((gm - 1) * type.m * C_LIGHT * C_LIGHT) / QE;
      label(g, `${fmtEV(K)} · ${num(v / C_LIGHT, 3)} c`, cam.sx(d.x) + 12, cam.sy(d.y) - 12, rgba(rgb, 0.95), '500 12px "JetBrains Mono", monospace');
    }
    g.strokeStyle = rgba(rgb, 0.95);
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sx0, sy0, 5, 0, Math.PI * 2);
    g.stroke();
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
    label(g, fmtLen(s), x0, y0 - 12, 'rgba(232,236,244,0.85)', MONO_FONT);
  }
}
