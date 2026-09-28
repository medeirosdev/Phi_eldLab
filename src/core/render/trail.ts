/** Rastro em buffer circular; só grava um ponto novo se ele se afastou o suficiente do anterior. */
export class Trail {
  len = 0;
  private buf: Float64Array;
  private head = 0;
  private lx = 0;
  private ly = 0;

  constructor(readonly cap: number) {
    this.buf = new Float64Array(cap * 2);
  }

  push(x: number, y: number, minD2: number) {
    if (this.len > 0) {
      const dx = x - this.lx, dy = y - this.ly;
      if (dx * dx + dy * dy < minD2) return;
    }
    this.buf[this.head * 2] = x;
    this.buf[this.head * 2 + 1] = y;
    this.head = (this.head + 1) % this.cap;
    if (this.len < this.cap) this.len++;
    this.lx = x;
    this.ly = y;
  }

  clear() {
    this.len = 0;
    this.head = 0;
  }

  /** k = 0 é o ponto mais antigo. */
  x(k: number) {
    return this.buf[((this.head - this.len + k + this.cap) % this.cap) * 2];
  }

  y(k: number) {
    return this.buf[((this.head - this.len + k + this.cap) % this.cap) * 2 + 1];
  }
}
