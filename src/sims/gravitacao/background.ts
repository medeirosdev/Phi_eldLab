import { mulberry32 } from '../../core/math/rng';

/** Céu profundo: gradiente, nebulosas tênues e um campo de estrelas fixo. */
export function drawStarfield(g: CanvasRenderingContext2D, w: number, h: number) {
  const base = g.createRadialGradient(w * 0.55, h * 0.42, 0, w * 0.55, h * 0.42, Math.hypot(w, h) * 0.7);
  base.addColorStop(0, '#0c1226');
  base.addColorStop(0.55, '#070a15');
  base.addColorStop(1, '#03040a');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  g.globalCompositeOperation = 'lighter';
  const nebulae: [number, number, number, string, number][] = [
    [0.16, 0.22, 0.5, '255,140,60', 0.055],
    [0.86, 0.78, 0.55, '70,110,255', 0.07],
    [0.72, 0.12, 0.35, '170,90,255', 0.04],
    [0.3, 0.9, 0.4, '40,200,190', 0.03],
  ];
  const S = Math.max(w, h);
  for (const [fx, fy, fr, c, a] of nebulae) {
    const x = fx * w, y = fy * h, r = fr * S;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${c},${a})`);
    gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  const R = mulberry32(42);
  const tints = ['255,255,255', '190,210,255', '255,226,190', '210,225,255'];
  const count = Math.min(1600, (w * h) / 1300);
  for (let i = 0; i < count; i++) {
    const x = R() * w, y = R() * h;
    const big = R() > 0.94;
    const r = big ? 0.8 + R() * 0.9 : 0.35 + R() * 0.55;
    const a = big ? 0.5 + R() * 0.5 : 0.12 + R() * 0.5;
    g.fillStyle = `rgba(${tints[(R() * tints.length) | 0]},${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    if (big && R() > 0.6) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 6);
      gr.addColorStop(0, `rgba(200,220,255,${a * 0.25})`);
      gr.addColorStop(1, 'rgba(200,220,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
    }
  }
  g.globalCompositeOperation = 'source-over';
}
