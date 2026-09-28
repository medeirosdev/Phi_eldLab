import type { SimEntry } from './core/types';

/**
 * Catálogo de simulações. Para adicionar uma nova, crie a pasta em src/sims/
 * implementando `Simulation` e registre-a aqui — o núcleo não precisa mudar.
 * Cada módulo é carregado sob demanda (import dinâmico).
 */
export const registry: SimEntry[] = [
  {
    id: 'gravitacao',
    title: 'Gravitação',
    subtitle: 'Órbitas, leis de Kepler e o problema de N corpos, com dados reais do Sistema Solar.',
    accent: '#ffb547',
    tags: ['Mecânica', 'Kepler', 'N corpos'],
    status: 'ready',
    load: () => import('./sims/gravitacao'),
  },
  {
    id: 'campo-eletrico',
    title: 'Campo Elétrico',
    subtitle: 'Linhas de campo, superfícies equipotenciais e a lei de Coulomb com superposição.',
    accent: '#5ab0ff',
    tags: ['Eletrostática', 'Coulomb', 'Rutherford'],
    status: 'ready',
    load: () => import('./sims/campo-eletrico'),
  },
  {
    id: 'ondas',
    title: 'Tanque de Ondas',
    subtitle: 'Interferência, difração e refração resolvendo a equação de onda na GPU.',
    accent: '#3ee6c4',
    tags: ['Ondulatória', 'Young', 'Huygens'],
    status: 'ready',
    load: () => import('./sims/ondas'),
  },
];
