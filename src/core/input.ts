import type { Camera } from './camera';
import type { PointerInfo } from './types';

/**
 * Unifica mouse, caneta e toque.
 * - Roda / pinça: zoom.  Botão direito, do meio ou Shift + arrastar / dois dedos: mover câmera.
 * - Botão esquerdo / um dedo: repassado para a simulação.
 */
export function attachInput(canvas: HTMLCanvasElement, cam: Camera, emit: (p: PointerInfo) => void): () => void {
  const pts = new Map<number, { x: number; y: number }>();
  let mode: 'none' | 'sim' | 'pan' | 'pinch' = 'none';
  let simId = -1;
  let pinchD = 0;
  let pinchC = { x: 0, y: 0 };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const info = (kind: PointerInfo['kind'], e: PointerEvent, p: { x: number; y: number }): PointerInfo => {
    const w = cam.toWorld(p.x, p.y);
    return { kind, wx: w.x, wy: w.y, sx: p.x, sy: p.y, button: e.button };
  };
  const centroid = () => {
    let x = 0, y = 0;
    for (const p of pts.values()) { x += p.x; y += p.y; }
    return { x: x / pts.size, y: y / pts.size };
  };
  const spread = () => {
    const [a, b] = [...pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2) {
      if (mode === 'sim') emit(info('cancel', e, p));
      mode = 'pinch';
      pinchD = spread();
      pinchC = centroid();
      return;
    }
    if (pts.size > 1) return;
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      mode = 'pan';
    } else if (e.button === 0) {
      mode = 'sim';
      simId = e.pointerId;
      emit(info('down', e, p));
    }
  };

  const move = (e: PointerEvent) => {
    const p = local(e);
    const prev = pts.get(e.pointerId);
    if (!prev) {
      if (mode === 'none' && e.pointerType === 'mouse') emit(info('hover', e, p));
      return;
    }
    pts.set(e.pointerId, p);
    if (mode === 'pan') {
      cam.pan(p.x - prev.x, p.y - prev.y);
    } else if (mode === 'pinch' && pts.size >= 2) {
      const c = centroid();
      const d = spread();
      cam.pan(c.x - pinchC.x, c.y - pinchC.y);
      if (pinchD > 0 && d > 0) cam.zoomAt(c.x, c.y, d / pinchD);
      pinchC = c;
      pinchD = d;
    } else if (mode === 'sim' && e.pointerId === simId) {
      emit(info('move', e, p));
    }
  };

  const up = (e: PointerEvent) => {
    const p = local(e);
    pts.delete(e.pointerId);
    if (mode === 'sim' && e.pointerId === simId) {
      emit(info(e.type === 'pointercancel' ? 'cancel' : 'up', e, p));
      mode = 'none';
    } else if (pts.size === 0) {
      mode = 'none';
    }
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    cam.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
  };

  const noMenu = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', noMenu);

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', noMenu);
  };
}
