import type { ChartDef } from '../core/types';
import { el } from './dom';

/** Gráfico em tempo real, leve (canvas puro), com escala automática. */
export class Chart {
  readonly el = el('div', 'chart');
  private cv = el('canvas');
  private g = this.cv.getContext('2d')!;
  private data: Float64Array[];
  private vals: HTMLElement[] = [];
  private len = 0;
  private head = 0;
  private w = 1;
  private h = 1;
  private ro: ResizeObserver;

  constructor(private def: ChartDef, private cap = 360) {
    this.el.append(el('h4', 'chart-title', def.title), this.cv);
    const legend = el('div', 'legend');
    for (const s of def.series) {
      const item = el('div', 'lg-item');
      const sw = el('span', 'sw');
      sw.style.background = s.color;
      sw.style.boxShadow = `0 0 8px ${s.color}`;
      const v = el('span', 'lg-val mono', '—');
      item.append(sw, el('span', 'lg-label', s.label), v);
      legend.append(item);
      this.vals.push(v);
    }
    this.el.append(legend);
    this.data = def.series.map(() => new Float64Array(cap));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.cv);
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, this.cv.clientWidth);
    this.h = Math.max(1, this.cv.clientHeight);
    this.cv.width = Math.round(this.w * dpr);
    this.cv.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  sample() {
    this.def.series.forEach((s, k) => (this.data[k][this.head] = s.get()));
    this.head = (this.head + 1) % this.cap;
    this.len = Math.min(this.len + 1, this.cap);
  }

  clear() {
    this.len = 0;
    this.head = 0;
    this.draw();
  }

  private at(k: number, i: number) {
    return this.data[k][(this.head - this.len + i + this.cap) % this.cap];
  }

  draw() {
    const { g, w, h, len } = this;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h * i) / 4) + 0.5;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
    if (len < 2) return;

    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < this.data.length; k++) {
      for (let i = 0; i < len; i++) {
        const v = this.at(k, i);
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!Number.isFinite(lo)) return;
    if (hi - lo < Math.max(Math.abs(hi), Math.abs(lo)) * 1e-9 || hi === lo) {
      const pad = Math.abs(hi) * 0.05 || 1;
      lo -= pad;
      hi += pad;
    }
    const pad = (hi - lo) * 0.1;
    lo -= pad;
    hi += pad;
    const Y = (v: number) => h - ((v - lo) / (hi - lo)) * h;

    if (lo < 0 && hi > 0) {
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.setLineDash([3, 4]);
      g.beginPath();
      g.moveTo(0, Math.round(Y(0)) + 0.5);
      g.lineTo(w, Math.round(Y(0)) + 0.5);
      g.stroke();
      g.setLineDash([]);
    }

    g.lineWidth = 1.6;
    g.lineJoin = 'round';
    this.def.series.forEach((s, k) => {
      g.strokeStyle = s.color;
      g.shadowColor = s.color;
      g.shadowBlur = 6;
      g.beginPath();
      for (let i = 0; i < len; i++) {
        const x = (i / (this.cap - 1)) * w;
        const y = Y(this.at(k, i));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;
      this.vals[k].textContent = this.def.format(this.at(k, len - 1));
    });
  }

  destroy() {
    this.ro.disconnect();
  }
}
