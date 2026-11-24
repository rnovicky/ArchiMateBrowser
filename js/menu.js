// UX-6: keyboard handling shared by the context menus (popupMenu in app.js) and
// the menus of the page (setupMenuButton): ↑/↓ move between the items that can
// be chosen and wrap around, Home and End go to the first and the last.

/** The items of a menu that can be chosen now (not disabled, not hidden, not in a closed submenu). */
export const menuItems = menu => [...menu.querySelectorAll('[role=menuitem], [role=menuitemradio]')].filter(b => !b.disabled && !b.hidden && !b.closest('[hidden]'));

const MOVES = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };

/**
 * CM-10 (2.27.0): → opens the submenu of the focused item (and goes to its first item), ← closes the submenu
 * the focus is in (and goes back to its item). Returns true when the key did that.
 */
export function moveInSubmenu(menu, ev) {
  const focused = menu.ownerDocument.activeElement;
  if (ev.key === 'ArrowRight' && focused?.getAttribute('aria-haspopup') === 'menu') {
    ev.preventDefault();
    if (focused.getAttribute('aria-expanded') !== 'true') focused.click();
    menuItems(focused.nextElementSibling)[0]?.focus();
    return true;
  }
  const sub = focused?.closest('.submenu');
  if (ev.key === 'ArrowLeft' && sub && menu.contains(sub)) {
    ev.preventDefault();
    const opener = sub.previousElementSibling;
    opener.click();
    opener.focus();
    return true;
  }
  return false;
}

/** Moves the focus for ↑/↓/Home/End; returns true when the key was one of them. */
export function moveInMenu(menu, ev) {
  const move = MOVES[ev.key];
  if (move === undefined) return false;
  ev.preventDefault();
  const items = menuItems(menu);
  if (!items.length) return true;
  const i = items.indexOf(menu.ownerDocument.activeElement);
  let next;
  if (move === 'first') next = 0;
  else if (move === 'last') next = items.length - 1;
  else if (i < 0) next = move > 0 ? 0 : items.length - 1;
  else next = (i + move + items.length) % items.length;
  items[next].focus();
  return true;
}
