const LINKEDIN = 'https://www.linkedin.com/in/guilhermedemedeiros/';
const GITHUB = 'https://github.com/medeirosdev';
const REPO = 'https://github.com/medeirosdev/Phi_eldLab';

const linkedinIcon =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11H3zM9.5 9.75h3.8v1.5h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1v5.45h-4v-4.83c0-1.15-.02-2.63-1.6-2.63-1.6 0-1.85 1.25-1.85 2.55v4.91h-4z"/></svg>';
const githubIcon =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.84c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>';

/** Modal "Autor" aberto pelo botão do canto superior direito. */
export function setupAbout(button: HTMLElement) {
  const dlg = document.createElement('dialog');
  dlg.className = 'about glass';
  dlg.setAttribute('aria-labelledby', 'about-name');
  dlg.innerHTML = `
    <button class="icon-btn about-close" aria-label="Fechar">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <div class="about-avatar" aria-hidden="true">GM</div>
    <p class="about-kicker">Criador do <span class="brand-phi">Φ</span>ield Lab</p>
    <h2 id="about-name">Guilherme de Medeiros Ellena</h2>
    <p class="about-org">
      <span>Matemática Aplicada e Computacional</span>
      <span class="about-dot" aria-hidden="true">·</span>
      <span>UNICAMP</span>
    </p>
    <p class="about-text">
      O Φield Lab reúne simulações de física feitas do zero: integradores numéricos, equações de onda na GPU
      e eletrostática relativística — tudo rodando no navegador, sem dependências.
    </p>
    <div class="about-links">
      <a class="btn primary" href="${LINKEDIN}" target="_blank" rel="noopener">${linkedinIcon}LinkedIn</a>
      <a class="btn ghost" href="${GITHUB}" target="_blank" rel="noopener">${githubIcon}GitHub</a>
    </div>
    <a class="about-repo" href="${REPO}" target="_blank" rel="noopener">Código-fonte do projeto ↗</a>`;
  document.body.append(dlg);

  const close = () => {
    dlg.classList.add('closing');
    setTimeout(() => {
      dlg.classList.remove('closing');
      dlg.close();
    }, 180);
  };
  button.addEventListener('click', () => dlg.showModal());
  dlg.querySelector('.about-close')!.addEventListener('click', close);
  // clique no fundo (fora do cartão) fecha
  dlg.addEventListener('click', (e) => {
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) close();
  });
  // não deixa atalhos das simulações (Espaço, R...) dispararem com o modal aberto
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
}
