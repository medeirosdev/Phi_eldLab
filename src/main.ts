import './ui/theme.css';
import { registry } from './registry';
import { renderHome } from './ui/home';
import { SimView } from './ui/simview';

const view = document.getElementById('view')!;
const nav = document.getElementById('nav')!;
let current: { destroy(): void } | null = null;
let routeToken = 0;

nav.innerHTML = registry
  .map((e) =>
    e.status === 'ready'
      ? `<a class="nav-link" href="#/${e.id}" data-id="${e.id}" style="--dot:${e.accent}"><i></i>${e.title}</a>`
      : `<span class="nav-link soon" aria-disabled="true" style="--dot:${e.accent}"><i></i>${e.title}<em>em breve</em></span>`,
  )
  .join('');

async function route() {
  const token = ++routeToken;
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const entry = registry.find((e) => e.id === id && e.status === 'ready');

  current?.destroy();
  current = null;
  view.innerHTML = '';
  view.classList.toggle('is-home', !entry);
  nav.querySelectorAll<HTMLElement>('.nav-link').forEach((a) => a.classList.toggle('active', !!entry && a.dataset.id === entry.id));
  document.documentElement.style.setProperty('--accent', entry?.accent ?? '#ffb547');

  if (!entry?.load) {
    document.title = 'Φield Lab — física ao vivo';
    current = renderHome(view);
    return;
  }
  document.title = `${entry.title} · Φield Lab`;
  view.innerHTML = '<div class="loading"><span></span></div>';
  const mod = await entry.load();
  if (token !== routeToken) return;
  view.innerHTML = '';
  current = new SimView(view, entry, new mod.default());
}

window.addEventListener('hashchange', route);
route();
