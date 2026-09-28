/** Seta de (x0, y0) até (x1, y1) em pixels de tela. */
export function arrow(
  g: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  color: string, width = 1.8, head = 7,
) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  const hl = Math.min(head, len * 0.6);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1 - ux * hl * 0.8, y1 - uy * hl * 0.8);
  g.stroke();
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - ux * hl - uy * hl * 0.55, y1 - uy * hl + ux * hl * 0.55);
  g.lineTo(x1 - ux * hl + uy * hl * 0.55, y1 - uy * hl - ux * hl * 0.55);
  g.closePath();
  g.fill();
}

/** Texto com sombra discreta, legível sobre qualquer fundo. */
export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font: string) {
  g.font = font;
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.85)';
  g.shadowBlur = 4;
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.shadowBlur = 0;
}
