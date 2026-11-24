// Minimal lazy-loading tree widget with keyboard navigation.
//
// EN-4: the WAI-ARIA tree pattern. The tree is one tab stop; the selected row is its
// aria-activedescendant, every row has its level, its position among its siblings and the
// number of them, and the keys are those of the pattern (arrows, Home, End, typing a name).
//
// Node spec:
// {
//   label: string, sub?: string (secondary text), title?: string (tooltip)
//   badge?: string, color?: string (badge background), icon?: string (glyph)
//   sprite?: url (icon shown inside the badge, before its text), iconSrc?: url (image instead of `icon`)
//   children?: spec[] | loadChildren?: async () => spec[]
//   expanded?: boolean, data?: any (passed to onSelect)
//   key?: string (unique among siblings; used by reveal() to find a path)
//   action?: { label, title, run() } (a small button at the end of the row, shown on
//     hover and on the selected row; the Delete key runs it on the selected row)
// }

import { t } from './i18n.js';

const PAGE = 200; // children rendered per "show more" step
let treeCount = 0; // makes the ids of rows unique on the page

/** Drag & drop payload type of tree rows (see the `dragData` option). */
export const DRAG_TYPE = 'application/x-archixmi-ref';

export class Tree {
  /**
   * @param onSelect(data, spec) called when a node is selected
   * @param dragData(spec) -> string|null: rows with a payload can be dragged
   *   (dataTransfer type DRAG_TYPE, plus the label as text/plain)
   * @param onMark(datas, mode) multi-selection (CM-6): Ctrl-click / Ctrl+Space
   *   ('toggle' one row) and Shift-click ('add' the rows from the last clicked
   *   one); isMarked(data) -> bool draws the marks (see refreshMarks)
   */
  constructor(container, { onSelect, dragData = null, onContextMenu = null, onMark = null, isMarked = null, label = '' } = {}) {
    this.root = document.createElement('ul');
    this.root.className = 'tree';
    this.root.setAttribute('role', 'tree');
    if (label) this.root.setAttribute('aria-label', label);
    this.root.tabIndex = 0;
    this.idPrefix = `tree${++treeCount}-`;
    this.rows = 0;
    this.typed = '';     // type-ahead: the letters typed in the last moment
    this.typedAt = 0;
    container.replaceChildren(this.root);
    this.onSelect = onSelect;
    this.dragData = dragData;
    this.onContextMenu = onContextMenu;
    this.onMark = onMark;
    this.isMarked = isMarked;
    this.selected = null;
    this.anchor = null; // last clicked row (start of a Shift-click range)
    this.root.addEventListener('keydown', e => this.#onKey(e));
  }

  setRoots(specs) {
    this.root.replaceChildren();
    this.selected = null;
    this.root.removeAttribute('aria-activedescendant');
    this.#renderChildren(this.root, specs);
  }

  #renderChildren(ul, specs, start = 0) {
    const end = Math.min(specs.length, start + PAGE);
    const level = ul === this.root ? 1 : Number(ul.parentElement.getAttribute('aria-level')) + 1;
    for (let i = start; i < end; i++) {
      const li = this.#renderNode(specs[i]);
      li.setAttribute('aria-level', String(level));
      li.setAttribute('aria-setsize', String(specs.length));
      li.setAttribute('aria-posinset', String(i + 1));
      ul.appendChild(li);
    }
    if (end < specs.length) {
      const li = document.createElement('li');
      li.className = 'tree-more';
      const b = document.createElement('button');
      b.textContent = t('Show {n} more (of {rest} remaining)…', { n: Math.min(PAGE, specs.length - end), rest: specs.length - end });
      b.addEventListener('click', () => { li.remove(); this.#renderChildren(ul, specs, end); });
      li.appendChild(b);
      ul.appendChild(li);
    }
    if (!specs.length) {
      const li = document.createElement('li');
      li.className = 'tree-empty';
      li.textContent = t('(empty)');
      ul.appendChild(li);
    }
  }

  #renderNode(spec) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.id = this.idPrefix + ++this.rows;
    li.setAttribute('aria-selected', 'false');
    const row = document.createElement('div');
    row.className = 'tree-row';
    const expandable = !!(spec.children || spec.loadChildren);

    const tog = document.createElement('span');
    tog.className = 'tree-toggle';
    tog.textContent = expandable ? '▸' : '';
    row.appendChild(tog);

    if (spec.iconSrc) {
      // sprite image on a light chip (black sprites stay visible on dark/selected rows)
      const ic = document.createElement('span');
      ic.className = 'tree-icon sprite-chip';
      const img = document.createElement('img');
      img.className = 'sprite';
      img.src = spec.iconSrc;
      img.alt = '';
      ic.appendChild(img);
      row.appendChild(ic);
    } else if (spec.icon) {
      const ic = document.createElement('span');
      ic.className = 'tree-icon';
      ic.textContent = spec.icon;
      row.appendChild(ic);
    }
    if (spec.badge) {
      const bd = document.createElement('span');
      bd.className = 'badge';
      if (spec.sprite) {
        const img = document.createElement('img');
        img.className = 'sprite';
        img.src = spec.sprite;
        img.alt = '';
        bd.appendChild(img);
      }
      bd.append(spec.badge);
      if (spec.color) bd.style.background = spec.color;
      row.appendChild(bd);
    }
    const lab = document.createElement('span');
    lab.className = 'tree-label' + (spec.muted ? ' muted' : '');
    lab.textContent = spec.label;
    lab.id = `${li.id}-label`;
    row.appendChild(lab);
    // the row's name: its label and its secondary text, not the text of its children
    const named = [lab.id];
    if (spec.sub) {
      const sub = document.createElement('span');
      sub.className = 'tree-sub';
      sub.textContent = spec.sub;
      sub.id = `${li.id}-sub`;
      named.push(sub.id);
      row.appendChild(sub);
    }
    li.setAttribute('aria-labelledby', named.join(' '));
    if (spec.action) {
      const act = document.createElement('button');
      act.type = 'button';
      act.className = 'tree-action';
      act.textContent = spec.action.label;
      act.title = spec.action.title || '';
      act.setAttribute('aria-label', spec.action.title || spec.action.label);
      act.tabIndex = -1; // the Delete key does it from the keyboard
      act.addEventListener('click', e => { e.stopPropagation(); spec.action.run(); });
      row.appendChild(act);
    }
    if (spec.title) row.title = spec.title;
    li.appendChild(row);
    li._spec = spec;

    if (expandable) li.setAttribute('aria-expanded', 'false');
    if (this.isMarked?.(spec.data)) row.classList.add('marked');
    tog.addEventListener('click', e => { e.stopPropagation(); this.toggle(li); });
    row.addEventListener('mousedown', e => { if (e.shiftKey) e.preventDefault(); }); // no text selection on Shift-click
    row.addEventListener('click', e => {
      if (this.onMark && spec.data !== undefined && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        const items = this.#visibleItems();
        const a = e.shiftKey && this.anchor ? items.indexOf(this.anchor) : -1, b = items.indexOf(li);
        if (a >= 0 && b >= 0) {
          this.onMark(items.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x._spec.data).filter(d => d !== undefined), 'add');
        } else {
          this.anchor = li;
          this.onMark([spec.data], 'toggle');
        }
        return;
      }
      this.anchor = li;
      this.select(li);
    });
    row.addEventListener('dblclick', () => expandable && this.toggle(li));
    row.addEventListener('contextmenu', e => {
      // select the row (silently: no details change yet), then let the app show its menu
      if (this.#menu(li, e)) { e.preventDefault(); this.select(li, { silent: true }); }
    });
    const payload = this.dragData?.(spec);
    if (payload) {
      row.draggable = true;
      row.addEventListener('dragstart', e => {
        e.dataTransfer.setData(DRAG_TYPE, payload);
        e.dataTransfer.setData('text/plain', spec.label);
        e.dataTransfer.effectAllowed = 'copy';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
    }
    if (spec.expanded) queueMicrotask(() => this.toggle(li, true));
    return li;
  }

  async toggle(li, force) {
    const spec = li._spec;
    if (!(spec.children || spec.loadChildren)) return;
    const open = force ?? li.getAttribute('aria-expanded') !== 'true';
    li.setAttribute('aria-expanded', String(open));
    li.querySelector(':scope > .tree-row > .tree-toggle').textContent = open ? '▾' : '▸';
    let ul = li.querySelector(':scope > ul');
    li.querySelector(':scope > .tree-error')?.remove(); // a previous load error (EN-2)
    if (!open) { if (ul) ul.hidden = true; return; }
    if (ul) { ul.hidden = false; return li._loading; } // a concurrent load may still be running
    ul = document.createElement('ul');
    ul.setAttribute('role', 'group');
    li.appendChild(ul);
    if (spec.children) { this.#renderChildren(ul, spec.children); return; }
    const loading = document.createElement('li');
    loading.className = 'tree-empty';
    loading.textContent = t('Loading…');
    ul.appendChild(loading);
    li.setAttribute('aria-busy', 'true');
    li._loading = (async () => {
      try {
        const kids = await spec.loadChildren();
        ul.replaceChildren();
        this.#renderChildren(ul, kids);
      } catch (e) {
        ul.remove(); // allow retry on next expand
        li.setAttribute('aria-expanded', 'false');
        li.querySelector(':scope > .tree-row > .tree-toggle').textContent = '▸';
        // EN-2: the error stays under the row with a Retry button (expanding again retries too)
        const err = document.createElement('div');
        err.className = 'tree-error';
        err.setAttribute('role', 'alert');
        err.append(t('Error: {message}', { message: e.message }), ' ');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'link';
        retry.textContent = t('Retry');
        retry.addEventListener('click', ev => { ev.stopPropagation(); this.toggle(li, true); });
        err.appendChild(retry);
        li.appendChild(err);
        throw e;
      } finally {
        li._loading = null;
        li.removeAttribute('aria-busy');
      }
    })();
    return li._loading.catch(() => {});
  }

  /** Select a node. `silent` updates the highlight only, without calling onSelect. */
  select(li, { silent = false } = {}) {
    this.selected?.querySelector(':scope > .tree-row').classList.remove('selected');
    this.selected?.setAttribute('aria-selected', 'false');
    this.selected = li;
    const row = li.querySelector(':scope > .tree-row');
    row.classList.add('selected');
    li.setAttribute('aria-selected', 'true');
    this.root.setAttribute('aria-activedescendant', li.id);
    row.scrollIntoView({ block: 'nearest' });
    if (!silent && li._spec.data !== undefined) this.onSelect?.(li._spec.data, li._spec);
  }

  /**
   * Expand the path of spec keys from the roots down (loading lazily and
   * paging through "show more" as needed) and select the last node silently.
   * Returns false if any key on the path is not found.
   */
  async reveal(keys) {
    let ul = this.root;
    for (let i = 0; i < keys.length; i++) {
      let li = this.#childByKey(ul, keys[i]);
      while (!li) {
        const more = ul.querySelector(':scope > li.tree-more > button');
        if (!more) return false;
        more.click();
        li = this.#childByKey(ul, keys[i]);
      }
      if (i === keys.length - 1) {
        this.select(li, { silent: true });
        li.querySelector(':scope > .tree-row').scrollIntoView({ block: 'center' });
        return true;
      }
      await this.toggle(li, true);
      ul = li.querySelector(':scope > ul');
      if (!ul) return false;
    }
    return false;
  }

  /** Redraw the multi-selection marks of the rendered rows (isMarked option). */
  refreshMarks() {
    for (const li of this.root.querySelectorAll('li[role=treeitem]')) {
      li.querySelector(':scope > .tree-row')?.classList.toggle('marked', !!this.isMarked?.(li._spec?.data));
    }
  }

  #childByKey(ul, key) {
    return [...ul.children].find(li => li._spec?.key === key) || null;
  }

  #visibleItems() {
    return [...this.root.querySelectorAll('li[role=treeitem]')].filter(li => li.offsetParent !== null);
  }

  /**
   * Context menu of a row: onContextMenu(data, spec, {x, y}) at the mouse,
   * or (keyboard) below the row's label. It returns true when it showed a
   * menu; otherwise the browser's own menu stays.
   */
  #menu(li, ev) {
    if (!this.onContextMenu || li._spec.data === undefined) return false;
    const lab = li.querySelector(':scope > .tree-row .tree-label') || li;
    const r = lab.getBoundingClientRect();
    const at = ev ? { x: ev.clientX, y: ev.clientY } : { x: r.left + 12, y: r.bottom + 2 };
    return this.onContextMenu(li._spec.data, li._spec, at) === true;
  }

  #onKey(e) {
    const items = this.#visibleItems();
    if (!items.length) return;
    const i = items.indexOf(this.selected);
    const cur = this.selected;
    switch (e.key) {
      case 'Delete':
        if (cur?._spec.action) { e.preventDefault(); cur._spec.action.run(); }
        break;
      case 'ArrowDown': this.select(items[Math.min(items.length - 1, i + 1)]); break;
      case 'ArrowUp': this.select(items[Math.max(0, i - 1)]); break;
      case 'ArrowRight':
        if (cur && cur.getAttribute('aria-expanded') === 'false') this.toggle(cur, true);
        else if (cur && i + 1 < items.length) this.select(items[i + 1]);
        break;
      case 'ArrowLeft':
        if (cur?.getAttribute('aria-expanded') === 'true') this.toggle(cur, false);
        else { const p = cur?.parentElement?.closest('li[role=treeitem]'); if (p) this.select(p); }
        break;
      case 'Home': this.select(items[0]); break;
      case 'End': this.select(items[items.length - 1]); break;
      case '*': // the pattern: expand the siblings of the row
        for (const sib of cur?.parentElement?.children || []) if (sib.getAttribute('aria-expanded') === 'false') this.toggle(sib, true);
        break;
      case 'Enter': if (cur) this.toggle(cur); break;
      case 'ContextMenu': if (cur) this.#menu(cur, null); break;
      case 'F10': if (e.shiftKey && cur) this.#menu(cur, null); else return; break;
      case ' ':
        if (!(e.ctrlKey || e.metaKey) || !cur || !this.onMark || cur._spec.data === undefined) return;
        this.anchor = cur;
        this.onMark([cur._spec.data], 'toggle');
        break;
      default:
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || !/\S/.test(e.key)) return;
        this.#typeAhead(e.key, items, i);
    }
    e.preventDefault();
  }

  /** Type-ahead: the next visible row whose label starts with the letters typed in the last second. */
  #typeAhead(key, items, from) {
    const now = Date.now();
    this.typed = now - this.typedAt < 1000 ? this.typed + key.toLowerCase() : key.toLowerCase();
    this.typedAt = now;
    const label = li => (li._spec.label || '').toLowerCase();
    const start = this.typed.length > 1 ? Math.max(from, 0) : from + 1; // a new letter moves on; more letters refine
    const order = [...items.slice(start), ...items.slice(0, start)];
    const found = order.find(li => label(li).startsWith(this.typed));
    if (found) this.select(found);
  }
}
