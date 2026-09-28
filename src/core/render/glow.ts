export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Sprites de brilho pré-renderizados. Desenhados com composição 'lighter'
 * produzem um bloom convincente por uma fração do custo de um pós-processamento.
 * - halo: brilho amplo e suave (estrelas, planetas);
 * - dot: ponto luminoso compacto (partículas).
 */
export function glowSprite(c: RGB, kind: 'halo' | 'dot' = 'halo'): HTMLCanvasElement {
  const key = `${kind}:${c.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = kind === 'halo' ? 128 : 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  if (kind === 'halo') {
    grad.addColorStop(0, rgba(c, 0.6));
    grad.addColorStop(0.1, rgba(c, 0.38));
    grad.addColorStop(0.3, rgba(c, 0.12));
    grad.addColorStop(0.6, rgba(c, 0.03));
    grad.addColorStop(1, rgba(c, 0));
  } else {
    const core = mix(c, [255, 255, 255], 0.6);
    grad.addColorStop(0, rgba(core, 1));
    grad.addColorStop(0.22, rgba(c, 0.85));
    grad.addColorStop(0.55, rgba(c, 0.2));
    grad.addColorStop(1, rgba(c, 0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  cache.set(key, cv);
  return cv;
}
