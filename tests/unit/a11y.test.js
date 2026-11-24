// EN-4: accessibility rules that can be checked without a person: colour contrast (WCAG 2.1) of the
// page's colours in both themes, read from css/app.css, and of the ArchiMate layer colours behind the
// dark text of badges and diagram elements.

import { describe, test, assert } from '../harness.js';
import { LAYERS } from '../../js/archimate.js';

const hex = c => { const v = c.replace('#', ''); const f = v.length === 3 ? [...v].map(x => x + x).join('') : v; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255); };
const lum = c => { const [r, g, b] = hex(c).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The custom properties of :root, light and dark, from the stylesheet. */
async function themes() {
  const css = await (await fetch('../css/app.css')).text();
  const vars = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(m => [m[1], m[2]]));
  const light = vars(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const dark = { ...light, ...vars(css.slice(darkStart, css.indexOf('}\n}', darkStart))) };
  return { light, dark };
}

// text and the background it is read on; AA: 4.5 for text
const PAIRS = [['ink', 'bg'], ['ink', 'panel'], ['muted', 'panel'], ['muted', 'bg'], ['error', 'panel'], ['ink', 'error-soft'], ['ink', 'accent-soft']];

describe('a11y', () => {
  test('the contrast formula gives the WCAG values', () => {
    assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
    assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.01);
  });

  for (const theme of ['light', 'dark']) {
    test(`text of the ${theme} theme can be read (WCAG AA, 4.5:1)`, async () => {
      const colours = (await themes())[theme];
      assert.equal(PAIRS.filter(([fg, bg]) => colours[fg] && colours[bg]).length, PAIRS.length, 'every colour was found in app.css');
      const low = PAIRS
        .map(([fg, bg]) => [fg, bg, contrast(colours[fg], colours[bg])])
        .filter(([, , c]) => c < 4.5)
        .map(([fg, bg, c]) => `${fg} on ${bg}: ${c.toFixed(2)}`);
      assert.deepEqual(low, []);
    });
  }

  test('dark text on every layer colour (badges, diagram elements) can be read in both themes', () => {
    // badges use #222 and diagram text #000 on the layer colour, whatever the theme
    const low = LAYERS.filter(l => contrast('#222222', l.color) < 4.5).map(l => `${l.label}: ${contrast('#222222', l.color).toFixed(2)}`);
    assert.deepEqual(low, []);
  });
});
