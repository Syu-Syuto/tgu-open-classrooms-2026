const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../timetable.js'), 'utf8');
const entry = { id: 'course-1', term: '秋学期', day: '月', period: 2, name: '教育学', room: 'N203' };
const wrap = entries => ({ format: 'tgu-personal-timetable', version: 1, academicYear: 2026, entries });

function browser(initial = []) {
  const nodes = new Map(), values = new Map([['tgu-personal-timetable-2026-v1', JSON.stringify(initial)]]);
  const state = { accept: true, failSave: false, changes: 0, prompts: [], downloads: [], blobs: [] };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', listeners: {}, dataset: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute() {}, after() {}, reset() {}, showModal() {}, remove() {},
      click() { state.downloads.push({ href: this.href, download: this.download }); } });
    return nodes.get(id);
  }
  const context = {
    document: { getElementById: node, createElement: node, body: { append() {} }, addEventListener() {} },
    localStorage: { getItem: key => values.get(key), setItem(key, value) { if (state.failSave) throw Error('quota'); values.set(key, value); } },
    window: { addEventListener() {}, dispatchEvent() { state.changes++; } },
    PERIOD_TIMES: { 1: ['08:30', '10:10'], 2: ['10:20', '12:00'] },
    tokyoParts: () => ({ year: '2026', month: '08', day: '01' }),
    resolveTerm: () => ({ isInSession: false }), escapeHtml: value => String(value),
    fetch: () => Promise.resolve({ ok: true, json: async () => ({ courses: [] }) }),
    confirm: prompt => { state.prompts.push(prompt); return state.accept; },
    Blob, URL: { createObjectURL(blob) { state.blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    Event, setInterval() {}, setTimeout() {}, console,
  };
  vm.runInNewContext(source, context);
  state.node = node;
  state.saved = () => JSON.parse(values.get('tgu-personal-timetable-2026-v1'));
  state.message = () => node('personalMessage').textContent;
  state.import = async (data, size) => {
    const input = node('importTimetable');
    input.files = [{ size: size ?? Buffer.byteLength(data), text: async () => data }];
    await input.listeners.change({ target: input });
    assert.equal(input.value, '');
    assert.equal(input.disabled, false);
  };
  return state;
}

test('export and import round trip all course fields and notify listeners', async () => {
  const a = browser([entry]);
  a.node('exportTimetable').listeners.click();
  assert.equal(a.downloads[0].download, 'tgu-timetable-2026.json');
  const json = await a.blobs[0].text();
  assert.deepEqual(JSON.parse(json).entries, [entry]);
  const b = browser();
  await b.import(json);
  assert.deepEqual(b.saved(), [entry]);
  assert.equal(b.changes, 1);
  assert.match(b.message(), /1件/);
});

test('malformed, unsupported, oversized and invalid data preserve existing timetable', async () => {
  const cases = ['{', JSON.stringify({ ...wrap([entry]), academicYear: 2027 }),
    JSON.stringify({ ...wrap([entry]), version: 2 }), JSON.stringify([entry]),
    JSON.stringify(wrap([{ ...entry, period: 8 }])), JSON.stringify(wrap([{ ...entry, name: ' ' }])),
    JSON.stringify(wrap([entry, entry])), JSON.stringify(wrap([null])),
    JSON.stringify(wrap(Array(1001).fill(entry)))];
  for (const json of cases) {
    const b = browser([entry]);
    await b.import(json);
    assert.deepEqual(b.saved(), [entry]);
    assert.equal(b.changes, 0);
    assert.equal(b.prompts.length, 0);
    assert.ok(b.message());
  }
  const b = browser([entry]);
  await b.import(JSON.stringify(wrap([])), 1024 * 1024 + 1);
  assert.deepEqual(b.saved(), [entry]);
  assert.match(b.message(), /1MB/);
});

test('cancel preserves timetable; confirm replaces all terms, including empty import', async () => {
  const b = browser([entry]);
  b.accept = false;
  await b.import(JSON.stringify(wrap([])));
  assert.deepEqual(b.saved(), [entry]);
  assert.equal(b.changes, 0);
  assert.match(b.prompts[0], /1件/);
  b.accept = true;
  await b.import(JSON.stringify(wrap([])));
  assert.deepEqual(b.saved(), []);
  assert.equal(b.node('exportTimetable').disabled, true);
});

test('save failure preserves data and reports failure; unknown fields are discarded', async () => {
  const b = browser([entry]);
  b.failSave = true;
  await b.import(JSON.stringify(wrap([])));
  assert.deepEqual(b.saved(), [entry]);
  assert.equal(b.changes, 0);
  assert.match(b.message(), /保存できません/);
  b.failSave = false;
  await b.import(JSON.stringify(wrap([{ ...entry, extra: '<script>' }])));
  assert.deepEqual(b.saved(), [entry]);
});
