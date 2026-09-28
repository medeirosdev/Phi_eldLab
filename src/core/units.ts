const MINUS = '−';
const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

const fixedFmt = new Map<string, Intl.NumberFormat>();
const sigFmt = new Map<number, Intl.NumberFormat>();

/** Número com casas decimais fixas, no padrão brasileiro (vírgula decimal). */
export function num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  const key = `${digits}`;
  let f = fixedFmt.get(key);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    fixedFmt.set(key, f);
  }
  return f.format(v).replace('-', MINUS);
}

/** Número com n algarismos significativos. */
export function sig(v: number, n = 3): string {
  if (!Number.isFinite(v)) return '—';
  let f = sigFmt.get(n);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: n });
    sigFmt.set(n, f);
  }
  return f.format(v).replace('-', MINUS);
}

export function superscript(n: number): string {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}

/** Notação científica legível: 2,65 × 10³³. Valores comuns ficam em notação decimal. */
export function sci(v: number, n = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -2 && e < 4) return num(v, Math.max(0, n - 1 - e));
  let m = Number((v / 10 ** e).toFixed(n - 1));
  if (Math.abs(m) >= 10) {
    m /= 10;
    e += 1;
  }
  return `${num(m, n - 1)} × 10${superscript(e)}`;
}

/** Passo "redondo" (1, 2 ou 5 × 10ᵏ) mais próximo de v. */
export function niceStep(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
