const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../pwa.js'), 'utf8');
async function browser({ ios = true, installed = true, notificationAPI = true, ipad = false } = {}) {
  const state = { messages: [], backgrounds: [], minute: 0, enabled: false, intervals: [], permissionCalls: 0 };
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return nodes.get(id);
  };
  const events = {};
  const registration = { active: { postMessage(message, ports) {
    state.messages.push(message);
    if (ports) queueMicrotask(() => ports[0].receive({ data: { ok: true } }));
  } }, addEventListener() {} };
  const context = {
    navigator: { userAgent: ipad ? 'Macintosh' : ios ? 'iPhone' : 'Android', platform: ipad ? 'MacIntel' : '',
      maxTouchPoints: ipad ? 5 : 0, standalone: installed,
      serviceWorker: { register: async () => registration, ready: Promise.resolve(registration), addEventListener() {} } },
    document: { hidden: false, getElementById: node, addEventListener(type, fn) { events[type] = fn; } },
    window: { matchMedia: () => ({ matches: installed }), addEventListener(type, fn) { events[type] = fn; } },
    localStorage: { getItem: key => key.includes('notifications') ? String(state.enabled) : '[]',
      setItem() { state.enabled = true; }, removeItem() { state.enabled = false; } },
    nextNotificationClass(entries, date, background) { state.backgrounds.push(background); return {
      title: background ? '10:20開始 ｜ N203' : '次の授業まであと10分',
      body: `教育学\n${state.minute}時点`, startAt: 12345, updatedAt: state.minute,
    }; },
    MessageChannel: class { constructor() { this.port1 = { close() {} }; this.port2 = { receive: e => this.port1.onmessage(e) }; } },
    Date: class extends Date { constructor() { super(1794358800000 + state.minute * 60000); } },
    setTimeout: () => 1, clearTimeout() {}, setInterval(fn) { state.intervals.push(fn); }, console,
  };
  if (notificationAPI) {
    context.Notification = { permission: 'granted', async requestPermission() { state.permissionCalls++; return 'granted'; } };
    context.window.Notification = context.Notification;
  }
  vm.runInNewContext(source, context);
  await new Promise(setImmediate);
  state.node = node; state.events = events;
  state.enable = async () => { await node('enableNotifications').listeners.click(); await new Promise(setImmediate); };
  state.tick = async () => { state.minute++; state.intervals.forEach(fn => fn()); await new Promise(setImmediate); };
  return state;
}

test('iOS browser tab explains Home Screen installation and disables notifications', async () => {
  const b = await browser({ installed: false, notificationAPI: false });
  assert.equal(b.node('enableNotifications').disabled, true);
  assert.match(b.node('notificationStatus').textContent, /ホーム画面に追加/);
});
test('installed iPhone uses static time, room and course without a PushManager requirement', async () => {
  const b = await browser();
  assert.equal(b.node('enableNotifications').disabled, false);
  await b.enable();
  assert.equal(b.permissionCalls, 1);
  assert.equal(b.backgrounds.at(-1), true);
  assert.equal(b.messages.at(-1).payload.title, '10:20開始 ｜ N203');
  assert.match(b.messages.at(-1).payload.body, /教育学/);
  const count = b.messages.length;
  await b.tick(); await b.tick();
  assert.equal(b.messages.length, count, 'same iOS class is not re-notified every minute');
  b.events.pagehide();
  assert.equal(b.messages.length, count, 'iOS does not depend on pagehide delivery');
});
test('desktop-style iPad user agent is recognized as iOS', async () => {
  const b = await browser({ ipad: true });
  await b.enable();
  assert.equal(b.backgrounds.at(-1), true);
});
test('Android retains foreground countdown and background static notification', async () => {
  const b = await browser({ ios: false });
  await b.enable();
  assert.equal(b.backgrounds.at(-1), false);
  b.events.pagehide();
  assert.equal(b.backgrounds.at(-1), true);
});
test('older installed iOS without Notifications API explains upgrade requirement', async () => {
  const b = await browser({ notificationAPI: false });
  assert.equal(b.node('enableNotifications').disabled, true);
  assert.match(b.node('notificationStatus').textContent, /16.4/);
});
