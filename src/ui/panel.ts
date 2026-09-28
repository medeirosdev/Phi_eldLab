import type { ActionParam, ParamDef, RangeParam, ReadoutDef, SelectParam, Simulation, ToggleParam } from '../core/types';
import { Chart } from './chart';
import { el } from './dom';

/** Painel lateral gerado inteiramente a partir das definições da simulação. */
export class Panel {
  readonly el = el('div', 'panel-inner');
  private syncers: Array<() => void> = [];
  private rows: Array<{ def: ReadoutDef; row: HTMLElement; val: HTMLElement }> = [];
  private groups: Array<{ sec: HTMLElement; rows: HTMLElement[] }> = [];
  private charts: Chart[] = [];
  private presetBtns = new Map<string, HTMLButtonElement>();
  private presetDesc = el('p', 'preset-desc');

  constructor(private sim: Simulation, private onPreset: (id: string) => void) {
    this.buildPresets();
    this.buildReadouts();
    this.buildCharts();
    this.buildParams();
  }

  private section(title: string) {
    const sec = el('details', 'sec');
    sec.open = true;
    const sum = el('summary');
    sum.append(el('span', undefined, title));
    const body = el('div', 'sec-body');
    sec.append(sum, body);
    this.el.append(sec);
    return { sec, body };
  }

  private byGroup<T extends { group?: string }>(items: T[], fallback: string): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const it of items) {
      const k = it.group ?? fallback;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return m;
  }

  private buildPresets() {
    if (!this.sim.presets.length) return;
    const { body } = this.section('Cenários');
    const wrap = el('div', 'presets');
    for (const p of this.sim.presets) {
      const b = el('button', 'chip', p.label);
      b.type = 'button';
      b.title = p.description;
      b.addEventListener('click', () => this.onPreset(p.id));
      this.presetBtns.set(p.id, b);
      wrap.append(b);
    }
    body.append(wrap, this.presetDesc);
  }

  private buildReadouts() {
    for (const [name, defs] of this.byGroup(this.sim.readouts, 'Mostradores')) {
      const { sec, body } = this.section(name);
      const list = el('div', 'readouts');
      const rows: HTMLElement[] = [];
      for (const def of defs) {
        const row = el('div', 'ro');
        const lab = el('span', 'ro-label', def.label);
        if (def.hint) {
          lab.title = def.hint;
          lab.classList.add('has-hint');
        }
        const val = el('span', 'ro-val mono');
        row.append(lab, val);
        list.append(row);
        rows.push(row);
        this.rows.push({ def, row, val });
      }
      body.append(list);
      this.groups.push({ sec, rows });
    }
  }

  private buildCharts() {
    if (!this.sim.charts.length) return;
    const { body } = this.section('Gráficos');
    for (const def of this.sim.charts) {
      const c = new Chart(def);
      this.charts.push(c);
      body.append(c.el);
    }
  }

  private buildParams() {
    for (const [name, defs] of this.byGroup(this.sim.params, 'Controles')) {
      const { body } = this.section(name);
      for (const def of defs) body.append(this.control(def));
    }
  }

  private control(def: ParamDef): HTMLElement {
    let node: HTMLElement;
    if (def.type === 'range') node = this.range(def);
    else if (def.type === 'toggle') node = this.toggle(def);
    else if (def.type === 'action') node = this.action(def);
    else node = this.select(def);
    if (def.hint) node.title = def.hint;
    return node;
  }

  private range(def: RangeParam) {
    const wrap = el('label', 'ctl ctl-range');
    const head = el('div', 'ctl-head');
    const out = el('output', 'mono');
    head.append(el('span', undefined, def.label), out);
    const inp = el('input');
    inp.type = 'range';
    inp.min = String(def.min);
    inp.max = String(def.max);
    inp.step = String(def.step);
    const show = () => {
      out.textContent = def.format ? def.format(def.value) : String(def.value);
      inp.style.setProperty('--p', `${((def.value - def.min) / (def.max - def.min)) * 100}%`);
    };
    inp.addEventListener('input', () => {
      def.value = Number(inp.value);
      show();
      this.sim.onParam(def.key, def.value);
    });
    this.syncers.push(() => {
      inp.value = String(def.value);
      show();
    });
    wrap.append(head, inp);
    return wrap;
  }

  private toggle(def: ToggleParam) {
    const wrap = el('label', 'ctl ctl-toggle');
    const inp = el('input', 'sr');
    inp.type = 'checkbox';
    inp.addEventListener('change', () => {
      def.value = inp.checked;
      this.sim.onParam(def.key, def.value);
    });
    this.syncers.push(() => (inp.checked = def.value));
    wrap.append(el('span', undefined, def.label), inp, el('span', 'switch'));
    return wrap;
  }

  private action(def: ActionParam) {
    const wrap = el('div', 'ctl ctl-action');
    const b = el('button', undefined, def.label);
    b.type = 'button';
    b.addEventListener('click', () => this.sim.onParam(def.key, true));
    wrap.append(b);
    return wrap;
  }

  private select(def: SelectParam) {
    const wrap = el('div', 'ctl ctl-select');
    wrap.append(el('div', 'ctl-head', def.label));
    const short = def.options.length <= 4 && def.options.reduce((n, o) => n + o.label.length, 0) <= 34;
    if (short) {
      const seg = el('div', 'seg');
      const btns = def.options.map((o) => {
        const b = el('button', undefined, o.label);
        b.type = 'button';
        b.addEventListener('click', () => {
          def.value = o.value;
          sync();
          this.sim.onParam(def.key, def.value);
        });
        seg.append(b);
        return b;
      });
      const sync = () => btns.forEach((b, i) => b.classList.toggle('on', def.options[i].value === def.value));
      this.syncers.push(sync);
      wrap.append(seg);
    } else {
      const sel = el('select');
      for (const o of def.options) {
        const opt = el('option', undefined, o.label);
        opt.value = o.value;
        sel.append(opt);
      }
      sel.addEventListener('change', () => {
        def.value = sel.value;
        this.sim.onParam(def.key, def.value);
      });
      this.syncers.push(() => (sel.value = def.value));
      wrap.append(sel);
    }
    return wrap;
  }

  refresh() {
    for (const s of this.syncers) s();
    for (const [id, b] of this.presetBtns) b.classList.toggle('active', id === this.sim.currentPreset);
    this.presetDesc.textContent = this.sim.presets.find((p) => p.id === this.sim.currentPreset)?.description ?? '';
    this.tick();
  }

  /** Atualiza os mostradores (chamado algumas vezes por segundo). */
  tick() {
    for (const r of this.rows) {
      const vis = r.def.visible ? r.def.visible() : true;
      r.row.hidden = !vis;
      if (vis) {
        const v = r.def.get();
        if (r.val.textContent !== v) r.val.textContent = v;
      }
    }
    for (const g of this.groups) g.sec.hidden = g.rows.every((r) => r.hidden);
  }

  sampleCharts() {
    for (const c of this.charts) c.sample();
  }

  drawCharts() {
    for (const c of this.charts) c.draw();
  }

  clearCharts() {
    for (const c of this.charts) c.clear();
  }

  destroy() {
    for (const c of this.charts) c.destroy();
  }
}
