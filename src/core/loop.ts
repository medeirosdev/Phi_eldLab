import type { Simulation } from './types';

/** Orçamento de CPU para física por quadro (ms), para a interface nunca travar. */
const PHYSICS_BUDGET_MS = 11;

/**
 * Loop com passo fixo e acumulador: a física é determinística e idêntica
 * em monitores de 60 Hz ou 144 Hz; a renderização acompanha o requestAnimationFrame.
 */
export class Loop {
  running = true;
  speed = 1;
  /** Verdadeiro quando a CPU não deu conta do tempo pedido neste quadro. */
  slowed = false;
  steppedThisFrame = 0;

  private acc = 0;
  private last = 0;
  private raf = 0;

  constructor(private sim: Simulation, private frame: (dtReal: number) => void) {}

  start() {
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  step() {
    this.sim.step(this.sim.time.dt);
  }

  resetAccumulator() {
    this.acc = 0;
  }

  private tick(now: number) {
    const real = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let n = 0;
    this.slowed = false;
    if (this.running) {
      const { dt, scale } = this.sim.time;
      this.acc += real * scale * this.speed;
      const t0 = performance.now();
      while (this.acc >= dt) {
        this.sim.step(dt);
        this.acc -= dt;
        n++;
        if ((n & 7) === 0 && performance.now() - t0 > PHYSICS_BUDGET_MS) {
          this.slowed = this.acc >= dt;
          this.acc = 0;
          break;
        }
      }
    }
    this.steppedThisFrame = n;
    this.frame(real);
  }
}
