// Resizable panes (EN-7): drag the borders between the tree, diagram and
// details panes. Widths are remembered in the settings; double-click a border
// to reset it. Keyboard: focus a border (Tab), then ←/→ (Shift: larger steps),
// Home resets. Off in the narrow single-column layout.
// 2.28.0: the tree and the details pane can be closed (remembered), and full screen closes both while it lasts.

import { settings, saveSettings } from './config.js';
import { t } from './i18n.js';

const MIN = { tree: 160, details: 200 };
const MIN_DIAGRAM = 320;
const NARROW = window.matchMedia('(max-width: 900px)');

let control = null; // { closed, apply } once initPanes ran

/** Is the pane ('tree' or 'details') closed? */
export const paneClosed = key => !!control?.closed[key];

/** Close or open a side pane ('tree' or 'details'); `closed` omitted: toggle. Remembered in the settings. */
export function setPaneClosed(key, closed = !paneClosed(key), { remember = true } = {}) {
  if (!control) return;
  control.closed[key] = closed;
  if (remember) saveSettings({ paneClosed: { tree: control.closed.tree, details: control.closed.details } });
  control.apply();
  window.dispatchEvent(new Event('resize')); // diagrams and the minimap follow
  document.dispatchEvent(new CustomEvent('panes-changed'));
}

/** Full screen: the page fills the screen and both side panes close; leaving it opens them as they were. */
export async function toggleFullScreen() {
  if (document.fullscreenElement) { await document.exitFullscreen?.(); return; }
  await document.documentElement.requestFullscreen?.();
}

export function initPanes(layout, treePane, detailsPane) {
  layout.classList.add('resizable');
  const widths = { tree: null, details: null, ...(settings.paneWidths || {}) };
  const closed = { tree: false, details: false, ...(settings.paneClosed || {}) };

  /** Keep both widths within limits for the current window, then apply them. */
  const apply = () => {
    if (NARROW.matches) { layout.style.gridTemplateColumns = ''; place(); return; }
    const total = layout.clientWidth;
    const clamp = (w, key, other) => (w == null ? null
      : Math.round(Math.max(MIN[key], Math.min(w, total - MIN_DIAGRAM - (other ?? 0)))));
    const tw = closed.tree ? 0 : clamp(widths.tree, 'tree', closed.details ? 0 : widths.details);
    const dw = closed.details ? 0 : clamp(widths.details, 'details', tw);
    layout.classList.toggle('tree-closed', closed.tree);
    layout.classList.toggle('details-closed', closed.details);
    layout.style.gridTemplateColumns = `${tw != null ? tw + 'px' : 'minmax(240px, 22%)'} 1fr ${dw != null ? dw + 'px' : 'minmax(280px, 25%)'}`;
    place();
  };
  const save = () => saveSettings({ paneWidths: { tree: widths.tree, details: widths.details } });

  const splitter = (key, label) => {
    const s = document.createElement('div');
    s.className = 'pane-splitter';
    s.tabIndex = 0;
    s.setAttribute('role', 'separator');
    s.setAttribute('aria-orientation', 'vertical');
    s.setAttribute('aria-label', label);
    s.title = t('Drag to resize; double-click to reset');
    const current = () => (key === 'tree' ? treePane : detailsPane).getBoundingClientRect().width;
    s.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      try { s.setPointerCapture(ev.pointerId); } catch { /* pointer already gone */ }
      const x0 = ev.clientX, w0 = current();
      layout.classList.add('resizing');
      const move = e => {
        const dx = e.clientX - x0;
        widths[key] = key === 'tree' ? w0 + dx : w0 - dx; // the details pane grows to the left
        apply();
      };
      const up = () => {
        s.removeEventListener('pointermove', move);
        layout.classList.remove('resizing');
        widths[key] = Math.round(current());
        save();
        window.dispatchEvent(new Event('resize')); // diagrams and the minimap follow
      };
      s.addEventListener('pointermove', move);
      s.addEventListener('pointerup', up, { once: true });
      s.addEventListener('pointercancel', up, { once: true });
    });
    s.addEventListener('dblclick', () => { widths[key] = null; apply(); save(); });
    s.addEventListener('keydown', ev => {
      const step = ev.shiftKey ? 64 : 16;
      const grow = key === 'tree' ? 1 : -1; // → widens the tree, narrows the details pane
      if (ev.key === 'ArrowRight') widths[key] = current() + grow * step;
      else if (ev.key === 'ArrowLeft') widths[key] = current() - grow * step;
      else if (ev.key === 'Home') widths[key] = null;
      else return;
      ev.preventDefault();
      apply();
      if (widths[key] != null) widths[key] = Math.round(current());
      save();
    });
    layout.appendChild(s);
    return s;
  };

  const left = splitter('tree', t('Resize the model tree'));
  const right = splitter('details', t('Resize the details pane'));

  /** Splitters sit on the pane borders (absolute, over the grid). */
  function place() {
    const off = NARROW.matches;
    left.hidden = off || closed.tree;
    right.hidden = off || closed.details;
    if (off) return;
    left.style.left = `${treePane.offsetLeft + treePane.offsetWidth - 3}px`;
    right.style.left = `${detailsPane.offsetLeft - 3}px`;
  }

  window.addEventListener('resize', apply);
  NARROW.addEventListener?.('change', apply);
  control = { closed, apply };
  // full screen closes both side panes, without remembering it; leaving it brings back what was open
  let before = null;
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement && !before) {
      before = { ...closed };
      closed.tree = closed.details = true;
    } else if (!document.fullscreenElement && before) {
      Object.assign(closed, before);
      before = null;
    } else return;
    apply();
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new CustomEvent('panes-changed'));
  });
  apply();
}
