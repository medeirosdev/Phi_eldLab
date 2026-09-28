/**
 * Duas camadas de canvas nítidas em qualquer densidade de tela:
 * - bg: fundo estático, redesenhado só quando o tamanho muda;
 * - main: a simulação, redesenhada a cada quadro.
 * Todo desenho é feito em pixels CSS.
 */
export class Stage {
  readonly bg: HTMLCanvasElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  w = 1;
  h = 1;
  dpr = 1;
  drawBackground: ((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | null = null;
  /** Camada WebGL2 opcional, entre o fundo e a camada 2D (criada sob demanda). */
  gl: WebGL2RenderingContext | null = null;
  glCanvas: HTMLCanvasElement | null = null;

  private listeners: Array<() => void> = [];
  private ro: ResizeObserver;

  constructor(private host: HTMLElement) {
    this.bg = document.createElement('canvas');
    this.bg.className = 'stage-bg';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-main';
    host.prepend(this.bg, this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  onResize(fn: () => void) {
    this.listeners.push(fn);
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.bg, this.canvas, this.glCanvas]) {
      if (!c) continue;
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.paintBackground();
    for (const fn of this.listeners) fn();
  }

  paintBackground() {
    const b = this.bg.getContext('2d')!;
    b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    b.clearRect(0, 0, this.w, this.h);
    this.drawBackground?.(b, this.w, this.h);
  }

  /** Cria (uma vez) a camada WebGL2. Retorna null se o navegador não suportar. */
  enableGL(): WebGL2RenderingContext | null {
    if (this.gl) return this.gl;
    const c = document.createElement('canvas');
    c.className = 'stage-gl';
    const gl = c.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false });
    if (!gl) return null;
    this.bg.after(c);
    this.glCanvas = c;
    this.gl = gl;
    this.resize();
    return gl;
  }

  /** Prepara a camada principal para um novo quadro. */
  begin() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.w, this.h);
  }

  destroy() {
    this.ro.disconnect();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.glCanvas?.remove();
    this.bg.remove();
    this.canvas.remove();
  }
}
