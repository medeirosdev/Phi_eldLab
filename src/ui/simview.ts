import { Camera } from '../core/camera';
import { attachInput } from '../core/input';
import { Loop } from '../core/loop';
import { Stage } from '../core/render/stage';
import type { SimContext, SimEntry, Simulation } from '../core/types';
import { icons } from './icons';
import { Panel } from './panel';

const SPEEDS: [number, string][] = [
  [0.1, '0,1×'],
  [0.5, '½×'],
  [1, '1×'],
  [4, '4×'],
  [16, '16×'],
];

function storage(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Tela de uma simulação: palco, barra de controle de tempo e painel lateral. */
export class SimView {
  private stage: Stage;
  private camera = new Camera();
  private panel: Panel;
  private loop: Loop;
  private detachInput: () => void;
  private frameN = 0;
  private toastTimer = 0;
  private root: HTMLElement;
  private clockEl: HTMLElement;
  private rateEl: HTMLElement;
  private slowEl: HTMLElement;
  private playBtn: HTMLButtonElement;

  constructor(host: HTMLElement, entry: SimEntry, private sim: Simulation) {
    host.innerHTML = `
      <section class="simview">
        <div class="stage-host">
          <div class="hint glass" hidden>
            <span class="hint-text">${sim.hint}</span>
            <button class="icon-btn" data-act="hint-close" aria-label="Fechar dica">${icons.close}</button>
          </div>
          <div class="toast glass" role="status"></div>
          <button class="panel-btn glass" data-act="panel" aria-label="Abrir painel">${icons.sliders}<span>Painel</span></button>
          <div class="transport glass">
            <button class="tb" data-act="reset" title="Reiniciar cenário (R)">${icons.reset}</button>
            <button class="tb primary" data-act="play" title="Pausar / continuar (Espaço)"></button>
            <button class="tb" data-act="step" title="Avançar um passo (.)">${icons.step}</button>
            <span class="sep"></span>
            <div class="speeds">${SPEEDS.map(([s, l]) => `<button data-speed="${s}">${l}</button>`).join('')}</div>
            <span class="sep"></span>
            <div class="clock mono"><span class="clock-t"></span><small class="clock-rate"></small></div>
            <span class="slowed" hidden title="A CPU não acompanhou a velocidade pedida">limitado</span>
          </div>
        </div>
        <aside class="panel" aria-label="Painel de controle"></aside>
      </section>`;
    this.root = host.querySelector('.simview')!;
    this.root.style.setProperty('--accent', entry.accent);
    const stageHost = this.root.querySelector<HTMLElement>('.stage-host')!;
    this.clockEl = this.root.querySelector('.clock-t')!;
    this.rateEl = this.root.querySelector('.clock-rate')!;
    this.slowEl = this.root.querySelector('.slowed')!;
    this.playBtn = this.root.querySelector('[data-act="play"]')!;

    this.stage = new Stage(stageHost);
    this.camera.resize(this.stage.w, this.stage.h);
    this.stage.onResize(() => this.camera.resize(this.stage.w, this.stage.h));

    this.panel = new Panel(sim, (id) => {
      sim.loadPreset(id);
      this.loop.resetAccumulator();
    });
    this.root.querySelector('.panel')!.append(this.panel.el);

    const ctx: SimContext = {
      stage: this.stage,
      camera: this.camera,
      refreshUI: () => {
        this.panel.refresh();
        this.syncTransport();
      },
      resetCharts: () => this.panel.clearCharts(),
      toast: (m) => this.toast(m),
    };
    this.loop = new Loop(sim, (real) => this.frame(real));
    sim.init(ctx);
    this.detachInput = attachInput(this.stage.canvas, this.camera, (p) => sim.onPointer?.(p));

    this.wireTransport(entry.id);
    window.addEventListener('keydown', this.onKey);
    this.syncTransport();
    this.loop.start();
  }

  private wireTransport(id: string) {
    const hint = this.root.querySelector<HTMLElement>('.hint')!;
    const hintKey = `phield:hint:${id}`;
    if (!storage(hintKey)) hint.hidden = false;

    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-speed]');
      if (!t) return;
      if (t.dataset.speed) {
        this.loop.speed = Number(t.dataset.speed);
        this.syncTransport();
        return;
      }
      switch (t.dataset.act) {
        case 'play':
          this.loop.running = !this.loop.running;
          this.syncTransport();
          break;
        case 'step':
          this.loop.running = false;
          this.loop.step();
          this.syncTransport();
          break;
        case 'reset':
          this.sim.loadPreset(this.sim.currentPreset);
          this.loop.resetAccumulator();
          break;
        case 'panel':
          this.root.classList.toggle('panel-open');
          break;
        case 'hint-close':
          hint.hidden = true;
          storage(hintKey, '1');
          break;
      }
    });
  }

  private syncTransport() {
    this.playBtn.innerHTML = this.loop.running ? icons.pause : icons.play;
    this.root.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.speed) === this.loop.speed);
    });
    this.rateEl.textContent = this.sim.speedLabel(this.loop.speed);
    this.clockEl.textContent = this.sim.clock();
  }

  private frame(real: number) {
    this.camera.update(real);
    this.sim.render(real);
    this.frameN++;
    if (this.loop.steppedThisFrame > 0 && this.frameN % 2 === 0) this.panel.sampleCharts();
    if (this.frameN % 2 === 0) this.panel.drawCharts();
    if (this.frameN % 6 === 0) {
      this.panel.tick();
      this.clockEl.textContent = this.sim.clock();
      this.slowEl.hidden = !this.loop.slowed;
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.loop.running = !this.loop.running;
      this.syncTransport();
    } else if (e.key === '.') {
      this.loop.running = false;
      this.loop.step();
      this.syncTransport();
    } else if (e.key === 'r' || e.key === 'R') {
      this.sim.loadPreset(this.sim.currentPreset);
    } else if (this.sim.onKey?.(e)) {
      e.preventDefault();
    }
  };

  private toast(msg: string) {
    const el = this.root.querySelector<HTMLElement>('.toast')!;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  destroy() {
    this.loop.stop();
    this.detachInput();
    window.removeEventListener('keydown', this.onKey);
    clearTimeout(this.toastTimer);
    this.sim.dispose();
    this.panel.destroy();
    this.stage.destroy();
  }
}
