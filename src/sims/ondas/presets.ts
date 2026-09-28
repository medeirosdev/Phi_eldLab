import type { PresetDef } from '../../core/types';

/** Tanque de 40 × 24 cm, grade de 400 × 240 células (Δx = 1 mm). */
export const LX = 40;
export const LY = 24;
export const DX = 0.1;
export const NX = Math.round(LX / DX);
export const NY = Math.round(LY / DX);

export interface Source {
  x: number;
  y: number;
  /** Fontes em linha (ondas planas) vão de (x, y) a (x2, y2). */
  x2: number;
  y2: number;
  line: boolean;
  moving: boolean;
}

export type Mode = 'superficie' | 'amplitude' | 'intensidade';

export interface Theory {
  kind: 'young' | 'single';
  slitX: number;
  yc: number;
  d: number;
  a: number;
}

export interface WaveScene {
  f: number;
  c: number;
  n: number;
  vs: number;
  mode: Mode;
  sources: Source[];
  walls?: (x: number, y: number) => boolean;
  glass?: (x: number, y: number) => boolean;
  probe: [number, number] | null;
  screen: number | null;
  theory?: Theory;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'duas-fontes',
    label: 'Duas fontes',
    description:
      'Duas fontes em fase, separadas por d = 5 cm. Onde as ondas chegam em oposição de fase (diferença de caminho de meio comprimento de onda) surgem as linhas nodais — a água fica parada.',
  },
  {
    id: 'young',
    label: 'Fenda dupla',
    description:
      'Experimento de Young com ondas na água: uma onda plana atravessa duas fendas e produz franjas de interferência. O perfil medido na tela é comparado com a teoria de Huygens.',
  },
  {
    id: 'fenda',
    label: 'Difração',
    description:
      'Uma onda plana passa por uma fenda de 3 cm. A abertura se comporta como uma fileira de fontes (princípio de Huygens) e o feixe se abre com primeiro mínimo em sen θ = λ/a.',
  },
  {
    id: 'lente',
    label: 'Lente',
    description:
      'Uma lente biconvexa de "vidro": a onda é mais lenta no meio de índice n, os raios centrais atrasam e a frente de onda converge no foco. Mude n e veja o foco se deslocar.',
  },
  {
    id: 'snell',
    label: 'Refração',
    description:
      'Onda plana incidindo a 30° numa interface com um meio mais lento. A direção muda segundo a lei de Snell: sen θ₁ = n·sen θ₂, e o comprimento de onda encolhe para λ/n.',
  },
  {
    id: 'parabola',
    label: 'Espelho parabólico',
    description:
      'Frentes de onda planas refletem num espelho parabólico e convergem no foco — o princípio das antenas parabólicas e dos telescópios refletores.',
  },
  {
    id: 'doppler',
    label: 'Doppler e Mach',
    description:
      'Uma fonte em movimento comprime as ondas à frente e estica as de trás (efeito Doppler). Acima da velocidade da onda (v/c > 1) as frentes se acumulam num cone de Mach — o "estrondo sônico".',
  },
  {
    id: 'livre',
    label: 'Tanque livre',
    description: 'Uma fonte no centro. Desenhe paredes e vidro, adicione fontes e monte o seu próprio experimento.',
  },
];

const point = (x: number, y: number, moving = false): Source => ({ x, y, x2: x, y2: y, line: false, moving });
const plane = (x: number): Source => ({ x, y: -1, x2: x, y2: LY + 1, line: true, moving: false });

/** Parede vertical de x0 a x1 com aberturas (centro, largura). */
function barrier(x0: number, x1: number, gaps: [number, number][]) {
  return (x: number, y: number) =>
    x >= x0 && x <= x1 && !gaps.some(([c, w]) => Math.abs(y - c) < w / 2);
}

export const LENS = { cx: 15, cy: 12, R: 14, h: 7 };
export const PARABOLA = { vx: 36, cy: 12, F: 7, half: 11 };
export const SNELL = { x: 20, y: 12, angle: 30 };

export function buildScene(id: string): WaveScene {
  const yc = LY / 2;
  switch (id) {
    case 'young': {
      const d = 6, a = 0.8, slitX = 13;
      return {
        f: 15, c: 25, n: 1.5, vs: 0.6, mode: 'intensidade',
        sources: [plane(3)],
        walls: barrier(slitX - 0.2, slitX + 0.2, [[yc - d / 2, a], [yc + d / 2, a]]),
        probe: [36, yc], screen: 36,
        theory: { kind: 'young', slitX, yc, d, a },
      };
    }
    case 'fenda': {
      const a = 3, slitX = 13;
      return {
        f: 20, c: 25, n: 1.5, vs: 0.6, mode: 'superficie',
        sources: [plane(3)],
        walls: barrier(slitX - 0.2, slitX + 0.2, [[yc, a]]),
        probe: [36, yc], screen: 36,
        theory: { kind: 'single', slitX, yc, d: 0, a },
      };
    }
    case 'lente': {
      const { cx, cy, R, h } = LENS;
      const s = R - Math.sqrt(R * R - h * h);
      return {
        f: 15, c: 25, n: 1.5, vs: 0.6, mode: 'superficie',
        sources: [plane(3)],
        glass: (x, y) =>
          Math.hypot(x - (cx + R - s), y - cy) < R && Math.hypot(x - (cx - R + s), y - cy) < R,
        probe: null, screen: null,
      };
    }
    case 'snell': {
      const t = (SNELL.angle * Math.PI) / 180;
      const nx = Math.cos(t), ny = Math.sin(t);
      return {
        f: 12, c: 25, n: 1.6, vs: 0.6, mode: 'superficie',
        sources: [plane(3)],
        glass: (x, y) => (x - SNELL.x) * nx + (y - SNELL.y) * ny > 0,
        probe: null, screen: null,
      };
    }
    case 'parabola': {
      const { vx, cy, F, half } = PARABOLA;
      return {
        f: 12, c: 25, n: 1.5, vs: 0.6, mode: 'superficie',
        sources: [plane(3)],
        walls: (x, y) => Math.abs(y - cy) <= half && Math.abs(x - (vx - (y - cy) ** 2 / (4 * F))) < 0.25,
        probe: null, screen: null,
      };
    }
    case 'doppler':
      return {
        f: 10, c: 25, n: 1.5, vs: 0.6, mode: 'superficie',
        sources: [point(4, yc, true)],
        probe: null, screen: null,
      };
    case 'livre':
      return { f: 8, c: 25, n: 1.5, vs: 0.6, mode: 'superficie', sources: [point(LX / 2, yc)], probe: null, screen: null };
    default:
      return {
        f: 10, c: 25, n: 1.5, vs: 0.6, mode: 'superficie',
        sources: [point(12, yc - 2.5), point(12, yc + 2.5)],
        probe: [30, yc], screen: null,
      };
  }
}
