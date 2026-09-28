import { glowSprite, type RGB } from '../core/render/glow';

/** Pequenas animações ao vivo para os cartões da tela inicial. */
export interface Mini {
  resize(): void;
  frame(t: number): void;
}

function fit(cv: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h, dpr };
}

/** Sistema planetário inclinado; os períodos seguem a 3ª lei de Kepler (T ∝ a^1,5). */
export function miniOrbits(cv: HTMLCanvasElement): Mini {
  const planets: { a: number; e: number; w: number; c: RGB; s: number; ph: number }[] = [
    { a: 0.2, e: 0.2, w: 0.4, c: [201, 184, 166], s: 1.5, ph: 0.3 },
    { a: 0.34, e: 0.02, w: 2.1, c: [90, 176, 255], s: 2.2, ph: 2.2 },
    { a: 0.5, e: 0.09, w: 4.2, c: [255, 122, 89], s: 1.8, ph: 4.1 },
    { a: 0.8, e: 0.05, w: 0.9, c: [232, 178, 125], s: 3.2, ph: 1.2 },
  ];
  const trail = document.createElement('canvas');
  let g: CanvasRenderingContext2D, tg: CanvasRenderingContext2D, w = 1, h = 1, dpr = 1;
  return {
    resize() {
      ({ g, w, h, dpr } = fit(cv));
      trail.width = cv.width;
      trail.height = cv.height;
      tg = trail.getContext('2d')!;
      tg.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    frame(t) {
      const cx = w / 2, cy = h / 2, S = w * 0.5, tilt = 0.42;
      tg.globalCompositeOperation = 'destination-out';
      tg.fillStyle = 'rgba(0,0,0,0.06)';
      tg.fillRect(0, 0, w, h);
      tg.globalCompositeOperation = 'lighter';
      const pts: [number, number, typeof planets[0]][] = [];
      for (const p of planets) {
        const M = (t * 0.9) / Math.pow(p.a, 1.5) + p.ph;
        let E = M;
        for (let k = 0; k < 5; k++) E = M + p.e * Math.sin(E);
        const x = p.a * (Math.cos(E) - p.e), y = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
        const X = x * Math.cos(p.w) - y * Math.sin(p.w), Y = x * Math.sin(p.w) + y * Math.cos(p.w);
        const sx = cx + X * S, sy = cy + Y * S * tilt;
        tg.fillStyle = `rgba(${p.c.join(',')},0.55)`;
        tg.beginPath();
        tg.arc(sx, sy, p.s * 0.55, 0, Math.PI * 2);
        tg.fill();
        pts.push([sx, sy, p]);
      }
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(glowSprite([255, 200, 110], 'halo'), cx - 70, cy - 70, 140, 140);
      g.drawImage(trail, 0, 0, w, h);
      for (const [sx, sy, p] of pts) {
        const r = p.s * 5;
        g.drawImage(glowSprite(p.c, 'dot'), sx - r, sy - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'source-over';
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, 7);
      core.addColorStop(0, '#fff');
      core.addColorStop(1, '#ffc46b');
      g.fillStyle = core;
      g.beginPath();
      g.arc(cx, cy, 7, 0, Math.PI * 2);
      g.fill();
    },
  };
}

/** Dipolo elétrico: linhas de campo integradas numericamente, com "fluxo" animado. */
export function miniField(cv: HTMLCanvasElement): Mini {
  let g: CanvasRenderingContext2D, w = 1, h = 1;
  let lines: Path2D[] = [];
  let q: { x: number; y: number; s: number }[] = [];
  const E = (x: number, y: number) => {
    let ex = 0, ey = 0;
    for (const c of q) {
      const dx = x - c.x, dy = y - c.y;
      const r3 = Math.pow(dx * dx + dy * dy, 1.5) + 1e-6;
      ex += (c.s * dx) / r3;
      ey += (c.s * dy) / r3;
    }
    const m = Math.hypot(ex, ey) || 1;
    return [ex / m, ey / m];
  };
  return {
    resize() {
      ({ g, w, h } = fit(cv));
      q = [
        { x: w * 0.32, y: h * 0.5, s: 1 },
        { x: w * 0.68, y: h * 0.5, s: -1 },
      ];
      lines = [];
      const N = 18;
      for (let k = 0; k < N; k++) {
        const a = (2 * Math.PI * (k + 0.5)) / N;
        let x = q[0].x + 8 * Math.cos(a), y = q[0].y + 8 * Math.sin(a);
        const path = new Path2D();
        path.moveTo(x, y);
        for (let s = 0; s < 1600; s++) {
          const [ax, ay] = E(x, y);
          const [bx, by] = E(x + ax, y + ay);
          x += bx * 2;
          y += by * 2;
          path.lineTo(x, y);
          if (Math.hypot(x - q[1].x, y - q[1].y) < 7 || x < -40 || y < -40 || x > w + 40 || y > h + 40) break;
        }
        lines.push(path);
      }
    },
    frame(t) {
      g.clearRect(0, 0, w, h);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(90,176,255,0.18)';
      for (const p of lines) g.stroke(p);
      g.globalCompositeOperation = 'lighter';
      g.setLineDash([3, 14]);
      g.lineDashOffset = -t * 26;
      g.lineWidth = 1.6;
      g.strokeStyle = 'rgba(140,200,255,0.85)';
      for (const p of lines) g.stroke(p);
      g.setLineDash([]);
      const cols: RGB[] = [[255, 90, 110], [80, 140, 255]];
      q.forEach((c, i) => g.drawImage(glowSprite(cols[i], 'halo'), c.x - 46, c.y - 46, 92, 92));
      g.globalCompositeOperation = 'source-over';
      q.forEach((c, i) => {
        g.fillStyle = i === 0 ? '#ff6b7f' : '#5a95ff';
        g.beginPath();
        g.arc(c.x, c.y, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.font = '700 14px Inter, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(i === 0 ? '+' : '−', c.x, c.y + 0.5);
      });
      g.textAlign = 'start';
    },
  };
}

/** Interferência de duas fontes (princípio de Huygens), calculada pixel a pixel. */
export function miniWaves(cv: HTMLCanvasElement): Mini {
  const W = 200, H = 125;
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H);
  const src = [
    { x: W * 0.43, y: H * 0.5 },
    { x: W * 0.57, y: H * 0.5 },
  ];
  const r1 = new Float32Array(W * H), r2 = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      r1[y * W + x] = Math.hypot(x - src[0].x, y - src[0].y);
      r2[y * W + x] = Math.hypot(x - src[1].x, y - src[1].y);
    }
  }
  return {
    resize() {},
    frame(t) {
      const k = 0.6, om = 3.4, d = img.data;
      for (let i = 0; i < W * H; i++) {
        const a = r1[i], b = r2[i];
        let v = Math.sin(k * a - om * t) / Math.sqrt(1 + a * 0.09) + Math.sin(k * b - om * t) / Math.sqrt(1 + b * 0.09);
        v *= 0.75;
        let R = 6, G = 10, B = 18;
        if (v > 0) {
          const f = Math.min(1, v);
          R += (62 - R) * f + 120 * f * f * f;
          G += (230 - G) * f + 25 * f * f * f;
          B += (196 - B) * f + 50 * f * f * f;
        } else {
          const f = Math.min(1, -v) * 0.7;
          R += (14 - R) * f;
          G += (40 - G) * f;
          B += (80 - B) * f;
        }
        const o = i * 4;
        d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = '#ffffff';
      for (const s of src) {
        g.beginPath();
        g.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
        g.fill();
      }
    },
  };
}
