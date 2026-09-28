import { registry } from '../registry';
import { miniField, miniOrbits, miniWaves, type Mini } from './minis';

const MINIS: Record<string, (cv: HTMLCanvasElement) => Mini> = {
  gravitacao: miniOrbits,
  'campo-eletrico': miniField,
  ondas: miniWaves,
};

export function renderHome(host: HTMLElement): { destroy(): void } {
  const first = registry.find((e) => e.status === 'ready');
  host.innerHTML = `
    <div class="home">
      <section class="hero">
        <div class="eyebrow"><span class="pulse"></span>Laboratório de física interativa</div>
        <h1>A física,<br /><span class="grad">ao vivo.</span></h1>
        <p class="lead">
          Simulações rigorosas que rodam no navegador: equações de verdade, integradores numéricos de verdade,
          unidades de verdade. Lance, mexa, quebre — e veja as leis da natureza responderem.
        </p>
        <div class="cta">
          ${first ? `<a class="btn primary" href="#/${first.id}">Explorar ${first.title} <span aria-hidden="true">→</span></a>` : ''}
          <a class="btn ghost" href="https://github.com/medeirosdev/Phi_eldLab" target="_blank" rel="noopener">Código-fonte</a>
        </div>
        <dl class="facts">
          <div><dt>Verlet</dt><dd>integrador simplético</dd></div>
          <div><dt>ΔE/E₀</dt><dd>conservação medida ao vivo</dd></div>
          <div><dt>60 fps</dt><dd>direto no navegador</dd></div>
          <div><dt>0</dt><dd>dependências em produção</dd></div>
        </dl>
      </section>
      <section class="cards" aria-label="Simulações"></section>
      <footer class="foot"><span class="brand-phi">Φ</span>ield Lab · física para a sala de aula</footer>
    </div>`;

  const cards = host.querySelector('.cards')!;
  const anims: { mini: Mini; cv: HTMLCanvasElement; visible: boolean }[] = [];
  for (const e of registry) {
    const ready = e.status === 'ready';
    const card = document.createElement(ready ? 'a' : 'div');
    card.className = `card${ready ? '' : ' soon'}`;
    if (ready) (card as HTMLAnchorElement).href = `#/${e.id}`;
    card.style.setProperty('--card-accent', e.accent);
    card.innerHTML = `
      <div class="card-media"><canvas></canvas>${ready ? '' : '<span class="badge">Em breve</span>'}</div>
      <div class="card-body">
        <h3>${e.title}${ready ? '<span class="go" aria-hidden="true">→</span>' : ''}</h3>
        <p>${e.subtitle}</p>
        <div class="tags">${e.tags.map((t) => `<span>${t}</span>`).join('')}</div>
      </div>`;
    cards.append(card);
    const cv = card.querySelector('canvas')!;
    const make = MINIS[e.id];
    if (make) {
      const mini = make(cv);
      mini.resize();
      anims.push({ mini, cv, visible: true });
    }
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ro = new ResizeObserver(() => {
    for (const a of anims) {
      a.mini.resize();
      a.mini.frame(reduce ? 2 : performance.now() / 1000);
    }
  });
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const a = anims.find((x) => x.cv === en.target);
      if (a) a.visible = en.isIntersecting;
    }
  });
  for (const a of anims) {
    ro.observe(a.cv);
    io.observe(a.cv);
  }

  let raf = 0;
  if (!reduce) {
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      for (const a of anims) if (a.visible) a.mini.frame(now / 1000);
    };
    raf = requestAnimationFrame(tick);
  }

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    },
  };
}
