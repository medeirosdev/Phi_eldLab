/*
 * Unidades astronômicas: distância em UA, massa em massas solares (M☉), tempo em anos.
 * Nelas, G = 4π² exatamente (a 3ª lei de Kepler para a Terra vira T² = a³).
 * Os mostradores convertem para o SI.
 */
export const G = 4 * Math.PI * Math.PI;

export const AU = 1.495978707e11; // m
export const YEAR = 3.15576e7; // s (ano juliano)
export const MSUN = 1.98892e30; // kg
export const MEARTH = 3.0035e-6; // M☉
export const MJUP = 9.5479e-4; // M☉
export const RSUN = 4.6505e-3; // UA
export const REARTH = 4.2635e-5; // UA
export const RJUP = 4.7789e-4; // UA

export const KMS = AU / YEAR / 1000; // 1 UA/ano em km/s
export const JOULE = (MSUN * AU * AU) / (YEAR * YEAR); // 1 M☉·UA²/ano² em J
export const ANGMOM = (MSUN * AU * AU) / YEAR; // em kg·m²/s

export type Integrator = 'verlet' | 'rk4' | 'euler';

/**
 * Sistema de N corpos em estrutura de arrays (rápido e sem lixo para o GC).
 * Índices [0, nm) são corpos massivos (interagem entre si);
 * índices [nm, n) são partículas de teste (sentem a gravidade, mas não a produzem).
 */
export class NBody {
  n = 0;
  nm = 0;
  cap = 0;
  x = new Float64Array(0);
  y = new Float64Array(0);
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  ax = new Float64Array(0);
  ay = new Float64Array(0);
  m = new Float64Array(0);
  tag = new Uint8Array(0);
  /** Suavização de Plummer (ε²), evita a singularidade em r → 0. */
  eps2 = 1e-10;
  /** Menor escala de tempo orbital entre pares massivos (anos). */
  minTau = Infinity;
  substeps = 1;
  accValid = false;

  private s: Float64Array[] = [];

  constructor(cap = 256) {
    this.alloc(cap);
  }

  private alloc(cap: number) {
    const grow = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a.subarray(0, this.n));
      return b;
    };
    this.x = grow(this.x);
    this.y = grow(this.y);
    this.vx = grow(this.vx);
    this.vy = grow(this.vy);
    this.ax = grow(this.ax);
    this.ay = grow(this.ay);
    this.m = grow(this.m);
    const t = new Uint8Array(cap);
    t.set(this.tag.subarray(0, this.n));
    this.tag = t;
    this.s = Array.from({ length: 10 }, () => new Float64Array(cap));
    this.cap = cap;
  }

  private ensure(extra: number) {
    if (this.n + extra > this.cap) this.alloc(Math.max(this.cap * 2, this.n + extra));
  }

  private move(from: number, to: number) {
    this.x[to] = this.x[from];
    this.y[to] = this.y[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.ax[to] = this.ax[from];
    this.ay[to] = this.ay[from];
    this.m[to] = this.m[from];
    this.tag[to] = this.tag[from];
  }

  clear() {
    this.n = this.nm = 0;
    this.accValid = false;
    this.minTau = Infinity;
  }

  addMassive(x: number, y: number, vx: number, vy: number, m: number): number {
    this.ensure(1);
    if (this.n > this.nm) this.move(this.nm, this.n);
    const i = this.nm;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.m[i] = m; this.tag[i] = 0;
    this.nm++;
    this.n++;
    this.accValid = false;
    return i;
  }

  addTest(x: number, y: number, vx: number, vy: number, tag = 0): number {
    this.ensure(1);
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.m[i] = 0; this.tag[i] = tag;
    this.accValid = false;
    return i;
  }

  /** Remove um corpo massivo; o último massivo ocupa o lugar dele. */
  removeMassive(i: number) {
    const last = this.nm - 1;
    if (i !== last) this.move(last, i);
    if (this.n > this.nm) this.move(this.n - 1, last);
    this.nm--;
    this.n--;
    this.accValid = false;
  }

  removeTest(i: number) {
    if (i !== this.n - 1) this.move(this.n - 1, i);
    this.n--;
  }

  /** Aceleração gravitacional por soma direta (lei de Newton com superposição). */
  computeAcc(X: Float64Array, Y: Float64Array, AX: Float64Array, AY: Float64Array) {
    const { n, nm, m, eps2 } = this;
    AX.fill(0, 0, n);
    AY.fill(0, 0, n);
    let minT2 = Infinity;
    for (let i = 0; i < nm; i++) {
      const xi = X[i], yi = Y[i], mi = m[i];
      let axi = 0, ayi = 0;
      for (let j = i + 1; j < nm; j++) {
        const dx = X[j] - xi, dy = Y[j] - yi;
        const r2 = dx * dx + dy * dy + eps2;
        const r3 = r2 * Math.sqrt(r2);
        const inv = 1 / r3;
        const mj = m[j];
        axi += mj * dx * inv;
        ayi += mj * dy * inv;
        AX[j] -= mi * dx * inv;
        AY[j] -= mi * dy * inv;
        const ms = mi + mj;
        if (ms > 0) {
          const t = r3 / ms;
          if (t < minT2) minT2 = t;
        }
      }
      AX[i] += axi;
      AY[i] += ayi;
    }
    for (let p = nm; p < n; p++) {
      const xp = X[p], yp = Y[p];
      let a = 0, b = 0;
      for (let j = 0; j < nm; j++) {
        const dx = X[j] - xp, dy = Y[j] - yp;
        const r2 = dx * dx + dy * dy + eps2;
        const inv = 1 / (r2 * Math.sqrt(r2));
        a += m[j] * dx * inv;
        b += m[j] * dy * inv;
      }
      AX[p] = a;
      AY[p] = b;
    }
    for (let i = 0; i < n; i++) {
      AX[i] *= G;
      AY[i] *= G;
    }
    this.minTau = Math.sqrt(minT2 / G);
  }

  ensureAcc() {
    if (!this.accValid) {
      this.computeAcc(this.x, this.y, this.ax, this.ay);
      this.accValid = true;
    }
  }

  /**
   * Avança dt. Em encontros próximos o passo é subdividido automaticamente:
   * cada subpasso usa h ≤ η·τ, com τ = √(r³/G(m₁+m₂)) do par mais apertado
   * no instante atual — então o passo encolhe durante um mergulho, não só antes dele.
   */
  step(dt: number, integ: Integrator, eta: number, maxSub: number) {
    this.ensureAcc();
    const hMin = dt / maxSub;
    let left = dt, k = 0;
    while (left > 1e-15 * dt) {
      let h = this.nm > 1 && Number.isFinite(this.minTau) ? eta * this.minTau : left;
      h = Math.min(left, Math.max(h, hMin));
      // evita um último subpasso minúsculo
      if (left - h < 0.25 * h) h = left;
      if (integ === 'verlet') this.verlet(h);
      else if (integ === 'rk4') this.rk4(h);
      else this.euler(h);
      left -= h;
      k++;
    }
    this.substeps = k;
  }

  /** Velocity Verlet (kick-drift-kick): simplético, conserva energia a longo prazo. */
  private verlet(h: number) {
    const { n, x, y, vx, vy, ax, ay } = this;
    const hh = h * 0.5;
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * hh;
      vy[i] += ay[i] * hh;
      x[i] += vx[i] * h;
      y[i] += vy[i] * h;
    }
    this.computeAcc(x, y, ax, ay);
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * hh;
      vy[i] += ay[i] * hh;
    }
  }

  /** Euler explícito: simples e instável — as órbitas espiralam para fora. */
  private euler(h: number) {
    const { n, x, y, vx, vy, ax, ay } = this;
    for (let i = 0; i < n; i++) {
      x[i] += vx[i] * h;
      y[i] += vy[i] * h;
      vx[i] += ax[i] * h;
      vy[i] += ay[i] * h;
    }
    this.computeAcc(x, y, ax, ay);
  }

  /** Runge-Kutta clássico de 4ª ordem: muito preciso por passo, mas não simplético. */
  private rk4(h: number) {
    const { n, x, y, vx, vy, ax, ay } = this;
    const [tx, ty, tvx, tvy, tax, tay, sx, sy, svx, svy] = this.s;
    const h2 = h * 0.5;
    for (let i = 0; i < n; i++) {
      sx[i] = vx[i]; sy[i] = vy[i]; svx[i] = ax[i]; svy[i] = ay[i];
      tx[i] = x[i] + vx[i] * h2; ty[i] = y[i] + vy[i] * h2;
      tvx[i] = vx[i] + ax[i] * h2; tvy[i] = vy[i] + ay[i] * h2;
    }
    this.computeAcc(tx, ty, tax, tay);
    for (let i = 0; i < n; i++) {
      sx[i] += 2 * tvx[i]; sy[i] += 2 * tvy[i]; svx[i] += 2 * tax[i]; svy[i] += 2 * tay[i];
      tx[i] = x[i] + tvx[i] * h2; ty[i] = y[i] + tvy[i] * h2;
      tvx[i] = vx[i] + tax[i] * h2; tvy[i] = vy[i] + tay[i] * h2;
    }
    this.computeAcc(tx, ty, tax, tay);
    for (let i = 0; i < n; i++) {
      sx[i] += 2 * tvx[i]; sy[i] += 2 * tvy[i]; svx[i] += 2 * tax[i]; svy[i] += 2 * tay[i];
      tx[i] = x[i] + tvx[i] * h; ty[i] = y[i] + tvy[i] * h;
      tvx[i] = vx[i] + tax[i] * h; tvy[i] = vy[i] + tay[i] * h;
    }
    this.computeAcc(tx, ty, tax, tay);
    const h6 = h / 6;
    for (let i = 0; i < n; i++) {
      sx[i] += tvx[i]; sy[i] += tvy[i]; svx[i] += tax[i]; svy[i] += tay[i];
      x[i] += sx[i] * h6; y[i] += sy[i] * h6;
      vx[i] += svx[i] * h6; vy[i] += svy[i] * h6;
    }
    this.computeAcc(x, y, ax, ay);
  }

  /** Energias cinética e potencial dos corpos massivos (M☉·UA²/ano²). */
  energy(): { K: number; U: number } {
    const { nm, x, y, vx, vy, m, eps2 } = this;
    let K = 0, U = 0;
    for (let i = 0; i < nm; i++) {
      K += 0.5 * m[i] * (vx[i] * vx[i] + vy[i] * vy[i]);
      for (let j = i + 1; j < nm; j++) {
        const dx = x[j] - x[i], dy = y[j] - y[i];
        U -= (G * m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + eps2);
      }
    }
    return { K, U };
  }

  angMom(): number {
    let L = 0;
    for (let i = 0; i < this.nm; i++) L += this.m[i] * (this.x[i] * this.vy[i] - this.y[i] * this.vx[i]);
    return L;
  }

  com(): { x: number; y: number; vx: number; vy: number; M: number } {
    let M = 0, x = 0, y = 0, vx = 0, vy = 0;
    for (let i = 0; i < this.nm; i++) {
      const m = this.m[i];
      M += m; x += m * this.x[i]; y += m * this.y[i]; vx += m * this.vx[i]; vy += m * this.vy[i];
    }
    return M > 0 ? { x: x / M, y: y / M, vx: vx / M, vy: vy / M, M } : { x: 0, y: 0, vx: 0, vy: 0, M: 0 };
  }
}
