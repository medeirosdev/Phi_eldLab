const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  step: svg('<path d="M6 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  plus: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>'),
  minus: svg('<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>'),
  particle: svg('<circle cx="17" cy="7" r="2.5" fill="currentColor" stroke="none"/><path d="M4 20c3-1 6-4 8-7s2.5-4 4-5" stroke-dasharray="2 3"/>'),
  probe: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/>'),
  eraser: svg('<path d="M4 16l9-9 6 6-7 7H7z"/><path d="M13 20h7"/>'),
  source: svg('<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8M5 5a9.5 9.5 0 0 0 0 14M19 5a9.5 9.5 0 0 1 0 14"/>'),
  wall: svg('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 12h18M9 5v7M15 12v7"/>'),
  glass: svg('<path d="M12 3c4 3 4 15 0 18c-4-3-4-15 0-18z"/>'),
  ruler: svg('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
