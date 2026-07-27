// Visibility helpers for the [hidden]-attribute regime (CSP: no inline
// style attributes ship in index.html; [hidden]{display:none !important}
// backstops elements whose class sets a display).
//
// Always use these instead of el.style.display: a reveal that only writes
// style.display cannot beat the !important rule and silently stays hidden —
// the exact trap that kept 'unsafe-inline' in the CSP for weeks.

export function show(el, display) {
  if (!el) return;
  el.hidden = false;
  el.style.display = display || '';
}

export function hide(el) {
  if (!el) return;
  el.hidden = true;
}

export function isShown(el) {
  return !!el && !el.hidden;
}
