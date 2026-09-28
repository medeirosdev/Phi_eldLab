import type { PresetDef } from '../../core/types';
import { mulberry32 } from '../../core/math/rng';
import { G, MEARTH, MJUP } from './physics';

export type Kind = 'star' | 'giant' | 'rocky';

export interface BodySpec {
  name: string;
  m: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind?: Kind;
  color?: string;
}

export interface DustSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tag: number;
}

export interface Scene {
  bodies: BodySpec[];
  dust: DustSpec[];
  /** Metade da altura visível inicial (UA). */
  halfHeight: number;
  /** Anos simulados por segundo real. */
  scale: number;
  dt: number;
  eps: number;
  collisions?: boolean;
  /** Precisão do passo adaptativo (h ≤ η·τ). */
  eta?: number;
  dustPalette?: string[];
}

export const PRESETS: PresetDef[] = [
  {
    id: 'solar',
    label: 'Sistema Solar',
    description:
      'O Sol e os planetas de Mercúrio a Júpiter com órbitas reais (semieixo, excentricidade e periélio), mais 500 asteroides no cinturão principal.',
  },
  {
    id: 'troianos',
    label: 'Troianos de Júpiter',
    description:
      'Asteroides presos nos pontos de Lagrange L4 e L5, 60° à frente e 60° atrás de Júpiter. Acelere o tempo e veja os enxames oscilarem em torno desses pontos.',
  },
  {
    id: 'binaria',
    label: 'Binária + planeta',
    description:
      'Sistema Kepler-16: duas estrelas (0,69 e 0,20 M☉) orbitadas por um planeta do tamanho de Saturno — um "Tatooine" real, descoberto em 2011.',
  },
  {
    id: 'figura8',
    label: 'Figura-8',
    description:
      'Solução periódica do problema de três corpos encontrada por Moore (1993) e provada por Chenciner e Montgomery (2000). Troque o integrador para Euler e veja a órbita se desfazer.',
  },
  {
    id: 'sobrevoo',
    label: 'Encontro estelar',
    description:
      'Duas estrelas com discos de poeira em órbita elíptica. A cada passagem pelo pericentro, as forças de maré arrancam caudas e pontes espirais — o mesmo mecanismo que molda galáxias em interação (Toomre & Toomre, 1972).',
  },
  {
    id: 'pitagorico',
    label: 'Caos: 3 corpos',
    description:
      'Problema pitagórico de Burrau (1913): massas 3, 4 e 5 em repouso nos vértices de um triângulo retângulo 3-4-5. O movimento é caótico e acaba ejetando uma das estrelas.',
  },
  {
    id: 'vazio',
    label: 'Sandbox',
    description:
      'Apenas o Sol. Arraste para lançar corpos, toque para criar órbitas circulares e monte o seu próprio sistema.',
  },
];

const D2R = Math.PI / 180;

/** Estado cartesiano a partir de elementos orbitais (p = semilatus rectum, ϖ = longitude do periastro, ν = anomalia verdadeira). */
function conicState(mu: number, p: number, e: number, varpi: number, nu: number) {
  const r = p / (1 + e * Math.cos(nu));
  const th = nu + varpi;
  const k = Math.sqrt(mu / p);
  const vr = k * e * Math.sin(nu);
  const vt = k * (1 + e * Math.cos(nu));
  const c = Math.cos(th), s = Math.sin(th);
  return { x: r * c, y: r * s, vx: vr * c - vt * s, vy: vr * s + vt * c };
}

function orbit(mu: number, a: number, e: number, varpiDeg: number, nuDeg: number) {
  return conicState(mu, a * (1 - e * e), e, varpiDeg * D2R, nuDeg * D2R);
}

/** Leva tudo para o referencial do centro de massa (momento total nulo). */
function toCOM(sc: Scene): Scene {
  let M = 0, X = 0, Y = 0, VX = 0, VY = 0;
  for (const b of sc.bodies) {
    M += b.m; X += b.m * b.x; Y += b.m * b.y; VX += b.m * b.vx; VY += b.m * b.vy;
  }
  if (M > 0) {
    X /= M; Y /= M; VX /= M; VY /= M;
    for (const o of [...sc.bodies, ...sc.dust]) {
      o.x -= X; o.y -= Y; o.vx -= VX; o.vy -= VY;
    }
  }
  return sc;
}

function solar(): Scene {
  const R = mulberry32(7);
  const bodies: BodySpec[] = [{ name: 'Sol', m: 1, x: 0, y: 0, vx: 0, vy: 0, kind: 'star', color: '#ffd27a' }];
  // nome, massa (M☉), a (UA), e, ϖ (°), ν inicial (°), cor
  const planets: [string, number, number, number, number, number, string][] = [
    ['Mercúrio', 1.66e-7, 0.3871, 0.2056, 77.46, 40, '#c9b8a6'],
    ['Vênus', 2.448e-6, 0.7233, 0.0068, 131.6, 160, '#f3d08a'],
    ['Terra', MEARTH, 1.0, 0.0167, 102.9, 250, '#5ab0ff'],
    ['Marte', 3.227e-7, 1.5237, 0.0934, 336.0, 320, '#ff7a59'],
    ['Júpiter', MJUP, 5.2029, 0.0484, 14.73, 110, '#e8b27d'],
  ];
  for (const [name, m, a, e, w, nu, color] of planets) {
    bodies.push({ name, m, color, ...orbit(G * (1 + m), a, e, w, nu) });
  }
  const dust: DustSpec[] = [];
  for (let i = 0; i < 500; i++) {
    const s = orbit(G, 2.1 + 1.2 * R(), 0.12 * R(), 360 * R(), 360 * R());
    dust.push({ ...s, tag: 0 });
  }
  return toCOM({ bodies, dust, halfHeight: 5.8, scale: 0.5, dt: 0.002, eps: 1e-5, dustPalette: ['#d9b48a'] });
}

function troianos(): Scene {
  const R = mulberry32(11);
  const J = orbit(G * (1 + MJUP), 5.2029, 0.0484, 0, 0);
  const bodies: BodySpec[] = [
    { name: 'Sol', m: 1, x: 0, y: 0, vx: 0, vy: 0, kind: 'star', color: '#ffd27a' },
    { name: 'Júpiter', m: MJUP, color: '#e8b27d', ...J },
  ];
  // A configuração triangular de Lagrange é homográfica: girar o estado de Júpiter
  // em ±60° dá exatamente L4 e L5. Espalhamos um pouco para ver a libração.
  const dust: DustSpec[] = [];
  for (let i = 0; i < 400; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const ang = (side * 60 + (R() - 0.5) * 16) * D2R;
    const f = 1 + (R() - 0.5) * 0.05;
    const c = Math.cos(ang), s = Math.sin(ang), vf = 1 / Math.sqrt(f);
    dust.push({
      x: (J.x * c - J.y * s) * f,
      y: (J.x * s + J.y * c) * f,
      vx: (J.vx * c - J.vy * s) * vf,
      vy: (J.vx * s + J.vy * c) * vf,
      tag: side > 0 ? 0 : 1,
    });
  }
  return toCOM({ bodies, dust, halfHeight: 7, scale: 4, dt: 0.01, eps: 1e-4, dustPalette: ['#ffd08a', '#8ad0ff'] });
}

function binaria(): Scene {
  const mA = 0.6897, mB = 0.20255, M = mA + mB, mp = 0.333 * MJUP;
  const rel = orbit(G * M, 0.22431, 0.15944, 0, 0);
  const fa = -mB / M, fb = mA / M;
  const pl = orbit(G * (M + mp), 0.7048, 0.0069, 318, 90);
  return toCOM({
    bodies: [
      { name: 'Kepler-16 A', m: mA, x: rel.x * fa, y: rel.y * fa, vx: rel.vx * fa, vy: rel.vy * fa },
      { name: 'Kepler-16 B', m: mB, x: rel.x * fb, y: rel.y * fb, vx: rel.vx * fb, vy: rel.vy * fb },
      { name: 'Kepler-16b', m: mp, color: '#e8c9a0', ...pl },
    ],
    dust: [],
    halfHeight: 1.0,
    scale: 0.15,
    dt: 2e-4,
    eps: 1e-5,
  });
}

function figura8(): Scene {
  // Condições iniciais de Chenciner & Montgomery (G = m = 1), reescaladas para G = 4π².
  const k = Math.sqrt(G);
  const x1 = 0.97000436, y1 = -0.24308753;
  const v3x = -0.93240737 * k, v3y = -0.86473146 * k;
  return {
    bodies: [
      { name: 'A', m: 1, kind: 'star', color: '#ffb547', x: x1, y: y1, vx: -v3x / 2, vy: -v3y / 2 },
      { name: 'B', m: 1, kind: 'star', color: '#5ab0ff', x: -x1, y: -y1, vx: -v3x / 2, vy: -v3y / 2 },
      { name: 'C', m: 1, kind: 'star', color: '#ff6f9c', x: 0, y: 0, vx: v3x, vy: v3y },
    ],
    dust: [],
    halfHeight: 1.35,
    scale: 0.2,
    dt: 5e-4,
    eps: 1e-6,
  };
}

function sobrevoo(): Scene {
  const R = mulberry32(3);
  const mA = 1, mB = 1, M = mA + mB;
  // Órbita relativa ligada: pericentro de 38 UA, e = 0,6 (período ≈ 650 anos).
  const q = 38, e = 0.6;
  const rel = conicState(G * M, q * (1 + e), e, 150 * D2R, -150 * D2R);
  const A = { x: -rel.x / 2, y: -rel.y / 2, vx: -rel.vx / 2, vy: -rel.vy / 2 };
  const B = { x: rel.x / 2, y: rel.y / 2, vx: rel.vx / 2, vy: rel.vy / 2 };
  const dust: DustSpec[] = [];
  // Anéis concêntricos, como nos experimentos de Toomre & Toomre: deixam as espirais nítidas.
  const disk = (host: typeof A, m: number, count: number, r0: number, r1: number, tag: number) => {
    const rings = 12;
    let rsum = 0;
    for (let k = 0; k < rings; k++) rsum += r0 + ((r1 - r0) * k) / (rings - 1);
    for (let k = 0; k < rings; k++) {
      const r = r0 + ((r1 - r0) * k) / (rings - 1);
      const nk = Math.round((count * r) / rsum);
      const v = Math.sqrt((G * m) / r);
      const off = R() * Math.PI * 2;
      for (let i = 0; i < nk; i++) {
        const th = off + (2 * Math.PI * i) / nk;
        dust.push({
          x: host.x + r * Math.cos(th),
          y: host.y + r * Math.sin(th),
          vx: host.vx - v * Math.sin(th),
          vy: host.vy + v * Math.cos(th),
          tag,
        });
      }
    }
  };
  disk(A, mA, 1400, 6, 28, 0);
  disk(B, mB, 1000, 5, 22, 1);
  return {
    bodies: [
      { name: 'Estrela A', m: mA, ...A, color: '#ffd27a', kind: 'star' },
      { name: 'Estrela B', m: mB, ...B, color: '#bcd4ff', kind: 'star' },
    ],
    dust,
    halfHeight: 120,
    scale: 25,
    dt: 0.04,
    eps: 0.35,
    dustPalette: ['#ffc78a', '#8ab8ff'],
  };
}

function pitagorico(): Scene {
  return {
    bodies: [
      { name: 'm = 3', m: 3, x: 1, y: 3, vx: 0, vy: 0 },
      { name: 'm = 4', m: 4, x: -2, y: -1, vx: 0, vy: 0 },
      { name: 'm = 5', m: 5, x: 1, y: -1, vx: 0, vy: 0 },
    ],
    dust: [],
    halfHeight: 4.5,
    scale: 0.25,
    dt: 5e-4,
    eps: 1e-4,
    eta: 0.002,
    collisions: false,
  };
}

function vazio(): Scene {
  return {
    bodies: [{ name: 'Sol', m: 1, x: 0, y: 0, vx: 0, vy: 0, kind: 'star', color: '#ffd27a' }],
    dust: [],
    halfHeight: 3,
    scale: 0.5,
    dt: 0.002,
    eps: 1e-5,
  };
}

const BUILDERS: Record<string, () => Scene> = { solar, troianos, binaria, figura8, sobrevoo, pitagorico, vazio };

export function buildScene(id: string): Scene {
  return (BUILDERS[id] ?? solar)();
}
