/**
 * Câmera 2D com eixo y para cima (convenção da física).
 * O zoom é animado suavemente e mantém fixo o ponto sob o cursor.
 */
export class Camera {
  x = 0;
  y = 0;
  /** Pixels por unidade de mundo. */
  zoom = 100;
  w = 1;
  h = 1;
  /** Disparado quando o usuário move a câmera manualmente. */
  onManualMove: (() => void) | null = null;

  private tx = 0;
  private ty = 0;
  private tzoom = 100;
  private anchor: { wx: number; wy: number; sx: number; sy: number } | null = null;

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  sx(wx: number) {
    return (wx - this.x) * this.zoom + this.w * 0.5;
  }

  sy(wy: number) {
    return (this.y - wy) * this.zoom + this.h * 0.5;
  }

  toWorld(sx: number, sy: number) {
    return {
      x: (sx - this.w * 0.5) / this.zoom + this.x,
      y: this.y - (sy - this.h * 0.5) / this.zoom,
    };
  }

  halfHeight() {
    return (this.h * 0.5) / this.zoom;
  }

  fit(cx: number, cy: number, halfHeight: number, instant = false) {
    this.tzoom = (this.h * 0.5) / halfHeight;
    this.tx = cx;
    this.ty = cy;
    this.anchor = null;
    if (instant) {
      this.zoom = this.tzoom;
      this.x = cx;
      this.y = cy;
    }
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const w = this.toWorld(sx, sy);
    this.tzoom = Math.min(1e12, Math.max(1e-9, this.tzoom * factor));
    this.anchor = { wx: w.x, wy: w.y, sx, sy };
  }

  pan(dsx: number, dsy: number) {
    this.x -= dsx / this.zoom;
    this.y += dsy / this.zoom;
    this.tx = this.x;
    this.ty = this.y;
    this.anchor = null;
    this.onManualMove?.();
  }

  /** Prende a câmera a um ponto (seguir um corpo, centro de massa...). */
  track(wx: number, wy: number) {
    this.x = this.tx = wx;
    this.y = this.ty = wy;
    this.anchor = null;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 14);
    if (Math.abs(this.zoom / this.tzoom - 1) > 1e-4) this.zoom *= Math.pow(this.tzoom / this.zoom, k);
    else this.zoom = this.tzoom;

    if (this.anchor) {
      const a = this.anchor;
      this.x = this.tx = a.wx - (a.sx - this.w * 0.5) / this.zoom;
      this.y = this.ty = a.wy + (a.sy - this.h * 0.5) / this.zoom;
      if (this.zoom === this.tzoom) this.anchor = null;
    } else {
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
    }
  }
}
