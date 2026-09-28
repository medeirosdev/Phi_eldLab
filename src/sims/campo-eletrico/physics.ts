/** Eletrostática no SI: distâncias em metros, cargas em coulombs. */
export const K = 8.9875517923e9; // N·m²/C²
export const QE = 1.602176634e-19; // C
export const C_LIGHT = 2.99792458e8; // m/s
export const NC = 1e-9;

/** Raio de suavização das cargas pontuais (m): evita campo infinito no centro. */
export const SOFT = 1.5e-3;
/** Raio visual/de captura de uma carga fixa (m). */
export const CHARGE_R = 3.5e-3;

export interface Charge {
  x: number;
  y: number;
  q: number;
}

export interface ParticleType {
  id: string;
  name: string;
  q: number;
  m: number;
  color: string;
}

export const PARTICLES: Record<string, ParticleType> = {
  eletron: { id: 'eletron', name: 'Elétron', q: -QE, m: 9.1093837015e-31, color: '#6ee7f2' },
  proton: { id: 'proton', name: 'Próton', q: QE, m: 1.67262192369e-27, color: '#ff8fa3' },
  alfa: { id: 'alfa', name: 'Partícula alfa', q: 2 * QE, m: 6.6446573357e-27, color: '#ffd36e' },
};

export interface FieldSample {
  ex: number;
  ey: number;
  v: number;
  /** Distância à carga mais próxima. */
  rmin: number;
}

/** Campo e potencial por superposição da lei de Coulomb. */
export function field(charges: Charge[], x: number, y: number, out: FieldSample): FieldSample {
  let ex = 0, ey = 0, v = 0, rmin = Infinity;
  const s2 = SOFT * SOFT;
  for (const c of charges) {
    const dx = x - c.x, dy = y - c.y;
    const d2 = dx * dx + dy * dy;
    const r2 = d2 + s2;
    const r = Math.sqrt(r2);
    const kq = K * c.q;
    ex += (kq * dx) / (r2 * r);
    ey += (kq * dy) / (r2 * r);
    v += kq / r;
    if (d2 < rmin) rmin = d2;
  }
  out.ex = ex;
  out.ey = ey;
  out.v = v;
  out.rmin = Math.sqrt(rmin);
  return out;
}

/** Energia potencial eletrostática do sistema de cargas, U = Σ k qᵢqⱼ / rᵢⱼ. */
export function systemEnergy(charges: Charge[]): number {
  let U = 0;
  for (let i = 0; i < charges.length; i++) {
    for (let j = i + 1; j < charges.length; j++) {
      const a = charges[i], b = charges[j];
      U += (K * a.q * b.q) / Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  return U;
}

/**
 * Partícula carregada com dinâmica relativística: dp/dt = qE, v = p / √(m² + p²/c²).
 * Integrada por leapfrog no momento, com subpassos adaptativos perto das cargas.
 */
export class Particle {
  px: number;
  py: number;
  alive = true;
  /** Direção inicial (para medir o ângulo de espalhamento). */
  readonly dir0: number;
  private f: FieldSample = { ex: 0, ey: 0, v: 0, rmin: 0 };

  constructor(public x: number, public y: number, vx: number, vy: number, readonly type: ParticleType, readonly b = NaN) {
    const g = 1 / Math.sqrt(Math.max(1e-12, 1 - (vx * vx + vy * vy) / (C_LIGHT * C_LIGHT)));
    this.px = g * type.m * vx;
    this.py = g * type.m * vy;
    this.dir0 = Math.atan2(vy, vx);
  }

  gamma() {
    const m = this.type.m;
    return Math.sqrt(1 + (this.px * this.px + this.py * this.py) / (m * m * C_LIGHT * C_LIGHT));
  }

  vel(): [number, number] {
    const gm = this.gamma() * this.type.m;
    return [this.px / gm, this.py / gm];
  }

  speed() {
    const [vx, vy] = this.vel();
    return Math.hypot(vx, vy);
  }

  /** Energia cinética relativística (γ − 1)mc², em J. */
  kinetic() {
    return (this.gamma() - 1) * this.type.m * C_LIGHT * C_LIGHT;
  }

  potential(charges: Charge[]) {
    return this.type.q * field(charges, this.x, this.y, this.f).v;
  }

  advance(charges: Charge[], dt: number, bound: number) {
    if (!this.alive) return;
    const q = this.type.q;
    let left = dt, n = 0;
    while (left > 0 && n < 4000) {
      const f = field(charges, this.x, this.y, this.f);
      const v = this.speed() + 1e-9;
      const a = (Math.abs(q) * Math.hypot(f.ex, f.ey)) / (this.type.m * this.gamma()) + 1e-9;
      const tau = Math.min(f.rmin / v, Math.sqrt(f.rmin / a));
      const h = Math.min(left, Math.max(0.01 * tau, dt / 4000));
      // kick–drift–kick no momento
      this.px += 0.5 * h * q * f.ex;
      this.py += 0.5 * h * q * f.ey;
      const [vx, vy] = this.vel();
      this.x += vx * h;
      this.y += vy * h;
      const f2 = field(charges, this.x, this.y, this.f);
      this.px += 0.5 * h * q * f2.ex;
      this.py += 0.5 * h * q * f2.ey;
      left -= h;
      n++;
      if (f2.rmin < CHARGE_R * 0.6 || Math.abs(this.x) > bound || Math.abs(this.y) > bound) {
        this.alive = false;
        return;
      }
    }
  }
}
