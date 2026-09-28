import type { PresetDef } from '../../core/types';
import { NC, type Charge } from './physics';

export interface Beam {
  type: string;
  /** Energia cinética inicial (eV). */
  energy: number;
  x: number;
  y0: number;
  y1: number;
}

export interface ElecScene {
  charges: Charge[];
  halfHeight: number;
  particle: string;
  beam?: Beam;
  probe: [number, number] | null;
  /** Centro inicial da câmera (m). */
  cx?: number;
  /** Linhas de campo por nC. */
  density?: number;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'unica',
    label: 'Carga isolada',
    description:
      'Uma carga pontual de +5 nC. O campo é radial e cai com 1/r² (lei de Coulomb); as equipotenciais são círculos. Mova a sonda e confira que |E|·r² fica constante.',
  },
  {
    id: 'dipolo',
    label: 'Dipolo',
    description:
      'Cargas +5 nC e −5 nC separadas por 6 cm. Todas as linhas que saem da carga positiva terminam na negativa, e a equipotencial V = 0 é o plano mediador.',
  },
  {
    id: 'iguais',
    label: 'Cargas iguais',
    description:
      'Duas cargas de +5 nC. As linhas se repelem e existe um ponto neutro (E = 0) exatamente no meio — um ponto de sela do potencial.',
  },
  {
    id: 'quadrupolo',
    label: 'Quadrupolo',
    description: 'Quatro cargas alternadas nos vértices de um quadrado. Carga total e momento de dipolo nulos: o campo decai com 1/r⁴ longe do centro.',
  },
  {
    id: 'capacitor',
    label: 'Capacitor',
    description:
      'Duas placas com cargas opostas criam um campo quase uniforme entre elas. Um feixe de elétrons de 4,7 keV é defletido numa parábola — como no tubo de um osciloscópio analógico.',
  },
  {
    id: 'rutherford',
    label: 'Rutherford',
    description:
      'Partículas alfa de 30 keV contra uma carga fixa de +20 nC. Cada trajetória é uma hipérbole; quanto menor o parâmetro de impacto b, maior o desvio: θ = 2·arctan(d₀/2b).',
  },
  {
    id: 'livre',
    label: 'Sandbox',
    description: 'Espaço vazio. Coloque cargas, solte partículas e explore.',
  },
];

export function buildScene(id: string): ElecScene {
  const q = 5 * NC;
  switch (id) {
    case 'unica':
      return { charges: [{ x: 0, y: 0, q }], halfHeight: 0.1, particle: 'proton', probe: [0.05, 0.02] };
    case 'iguais':
      return { charges: [{ x: -0.03, y: 0, q }, { x: 0.03, y: 0, q }], halfHeight: 0.09, particle: 'proton', probe: [0, 0] };
    case 'quadrupolo':
      return {
        charges: [
          { x: -0.03, y: 0.03, q }, { x: 0.03, y: 0.03, q: -q },
          { x: 0.03, y: -0.03, q }, { x: -0.03, y: -0.03, q: -q },
        ],
        halfHeight: 0.1, particle: 'proton', probe: null,
      };
    case 'capacitor': {
      const charges: Charge[] = [];
      for (let i = 0; i < 15; i++) {
        const x = -0.07 + i * 0.01;
        charges.push({ x, y: 0.025, q: 0.1 * NC }, { x, y: -0.025, q: -0.1 * NC });
      }
      return {
        charges, halfHeight: 0.08, particle: 'eletron', probe: [0, 0],
        beam: { type: 'eletron', energy: 4700, x: -0.13, y0: -0.004, y1: 0.004 },
      };
    }
    case 'rutherford':
      return {
        charges: [{ x: 0.03, y: 0, q: 20 * NC }], halfHeight: 0.09, particle: 'alfa', probe: null, cx: -0.02, density: 1,
        beam: { type: 'alfa', energy: 30000, x: -0.15, y0: -0.05, y1: 0.05 },
      };
    case 'livre':
      return { charges: [], halfHeight: 0.1, particle: 'proton', probe: null };
    default:
      return { charges: [{ x: -0.03, y: 0, q }, { x: 0.03, y: 0, q: -q }], halfHeight: 0.09, particle: 'proton', probe: [0, 0.03] };
  }
}
