import { describe, test, assert } from '../harness.js';
import { completions, highlightLine } from '../../js/scriptlang.js';

// 2.35.0: the script editor's colouring and completion (js/scriptlang.js)
describe('script editor', () => {
  test('colours keywords, types, texts, properties, references, numbers and comments', () => {
    const html = highlightLine('for each BusinessService where @Status = "XY" max 60  # a comment');
    assert.ok(html.includes('<span class="sh-kw">for</span>'), html);
    assert.ok(html.includes('<span class="sh-type">BusinessService</span>'), html);
    assert.ok(html.includes('<span class="sh-prop">@Status</span>'), html);
    assert.ok(html.includes('<span class="sh-string">"XY"</span>'), html);
    assert.ok(html.includes('<span class="sh-number">60</span>'), html);
    assert.ok(html.includes('<span class="sh-comment"># a comment</span>'), html);
    assert.ok(highlightLine('  elements #id-1, "A <b>"').includes('<span class="sh-ref">#id-1</span>'));
    assert.ok(highlightLine('  elements "A <b>"').includes('&lt;b&gt;'), 'escaped');
    assert.equal(highlightLine('# whole line'), '<span class="sh-comment"># whole line</span>');
    assert.ok(highlightLine('  diagram "{name} # not a comment"').includes('<span class="sh-string">"{name} # not a comment"</span>'));
  });

  test('completes keywords, types and layers, and property names after @', () => {
    const labels = prefix => completions(prefix).map(c => c.label);
    assert.ok(labels('neigh').includes('neighbourhood'));
    assert.ok(labels('BusinessSe').includes('BusinessService'));
    assert.ok(labels('Serv').includes('Serving'));
    assert.ok(labels('motiv').includes('motivation'));
    assert.ok(completions('Applic').some(c => c.label === '"Application Cooperation"'));
    assert.deepEqual(completions('ow', { prop: true, properties: ['Owner', 'Go live'] }).map(c => c.insert), ['Owner']);
    assert.deepEqual(completions('go', { prop: true, properties: ['Owner', 'Go live'] }).map(c => c.insert), ['"Go live"']);
    assert.ok(completions('e').length <= 8, 'a few at a time');
  });
});
