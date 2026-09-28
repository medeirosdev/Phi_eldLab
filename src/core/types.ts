import type { Camera } from './camera';
import type { Stage } from './render/stage';

export type ParamValue = number | boolean | string;

interface ParamBase {
  key: string;
  label: string;
  /** Seção do painel onde o controle aparece. */
  group?: string;
  hint?: string;
}

export interface RangeParam extends ParamBase {
  type: 'range';
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
}

export interface ToggleParam extends ParamBase {
  type: 'toggle';
  value: boolean;
}

export interface SelectParam extends ParamBase {
  type: 'select';
  value: string;
  options: { value: string; label: string }[];
}

export type ParamDef = RangeParam | ToggleParam | SelectParam;

export interface ReadoutDef {
  key: string;
  label: string;
  get: () => string;
  group?: string;
  visible?: () => boolean;
  hint?: string;
}

export interface SeriesDef {
  label: string;
  color: string;
  get: () => number;
}

export interface ChartDef {
  title: string;
  series: SeriesDef[];
  format: (v: number) => string;
}

export interface PresetDef {
  id: string;
  label: string;
  description: string;
}

export interface PointerInfo {
  kind: 'down' | 'move' | 'up' | 'cancel' | 'hover';
  /** Coordenadas no mundo da simulação. */
  wx: number;
  wy: number;
  /** Coordenadas na tela (px CSS). */
  sx: number;
  sy: number;
  button: number;
}

/** O que o núcleo oferece a uma simulação. */
export interface SimContext {
  stage: Stage;
  camera: Camera;
  /** Chame quando a própria simulação alterar parâmetros ou o cenário. */
  refreshUI(): void;
  resetCharts(): void;
  toast(msg: string): void;
}

export interface TimeConfig {
  /** Passo fixo de integração, em unidades de tempo da simulação. */
  dt: number;
  /** Tempo simulado por segundo real, na velocidade 1×. */
  scale: number;
}

/**
 * Contrato de um módulo de simulação. O núcleo não conhece nenhuma física:
 * painel, gráficos, mostradores e loop são gerados a partir destas definições.
 */
export interface Simulation {
  readonly params: ParamDef[];
  readonly presets: PresetDef[];
  readonly readouts: ReadoutDef[];
  readonly charts: ChartDef[];
  readonly time: TimeConfig;
  /** Dica de interação (aceita HTML simples). */
  readonly hint: string;
  currentPreset: string;

  init(ctx: SimContext): void;
  loadPreset(id: string): void;
  onParam(key: string, value: ParamValue): void;
  step(dt: number): void;
  render(dtReal: number): void;
  clock(): string;
  speedLabel(mult: number): string;
  onPointer?(p: PointerInfo): void;
  onKey?(e: KeyboardEvent): boolean;
  dispose(): void;
}

export interface SimEntry {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  tags: string[];
  status: 'ready' | 'soon';
  load?: () => Promise<{ default: new () => Simulation }>;
}
