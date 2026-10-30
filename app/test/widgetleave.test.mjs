// Leaving the app reloads the iPhone widgets once (30 Oct, over the air, every build). Owner on build 209: widgets
// changed only after the app was opened. The native fix (reload timing, an hour of minute entries) is on build-209 for
// build 210; this small JavaScript part reaches builds 201 to 209 now: when the app goes to the background and the
// widgets were last reloaded from the app over 2 minutes ago, it asks for one more reload so they start from fresh
// times as the phone is locked. It uses only iosNative.reloadWidgets, which every iPhone build since 201 has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const read = (rel) => fs.readFileSync(path.join(app, rel), 'utf8');
const BRIDGE = read('platform/iosBridge.ts');
const MOD = read('modules/transport-ios/index.ts');
const NATIVE = read('modules/transport-ios/ios/TransportIOSModule.swift');

function leaveRule() {
  const m = BRIDGE.match(/let widgetsReloadedAt = 0;\n\s*function reloadWidgetsOnLeave\(now = Date\.now\(\)\) \{([\s\S]*?)\n\s*\}\n/);
  assert.ok(m, 'reloadWidgetsOnLeave is in iosBridge.ts');
  const calls = [];
  const make = new Function('iosNative', 'WIDGET_LEAVE_RELOAD_MS', `let widgetsReloadedAt = 0;
    function reloadWidgetsOnLeave(now) {${m[1]}}
    return { leave: reloadWidgetsOnLeave, reloadedAt: (t) => { widgetsReloadedAt = t; } };`);
  return { calls, rule: make({ reloadWidgets: (k) => calls.push(k ?? null) }, 120000) };
}

test('leaving the app reloads the widgets once, only when the last reload was over 2 minutes ago', () => {
  const { calls, rule } = leaveRule();
  const t0 = 10 * 3600e3;
  rule.reloadedAt(t0);
  rule.leave(t0 + 30e3);
  assert.equal(calls.length, 0, 'just reloaded on coming to the front: no second reload');
  rule.leave(t0 + 121e3);
  assert.equal(calls.length, 1, 'over 2 min since the last reload: one reload');
  rule.leave(t0 + 150e3);
  assert.equal(calls.length, 1, 'leaving again within 2 min: nothing more');
  rule.leave(t0 + 400e3);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [null, null], 'all widgets, the same call the app already makes');
});

test('wired to going to the background, and the app reload on coming to the front counts', () => {
  assert.match(BRIDGE, /const WIDGET_LEAVE_RELOAD_MS = 120000;/);
  assert.match(BRIDGE, /else if \(s === 'background'\) \{ refreshCard\(true\); reloadWidgetsOnLeave\(\); \}/);
  assert.match(BRIDGE, /if \(changed \|\| force\) widgetsReloadedAt = Date\.now\(\);/);
  // Only inside the iPhone block that already needs the native module (Android and web never reach it).
  const gate = BRIDGE.indexOf("if (Platform.OS === 'ios' && iosNative.available()) {");
  assert.ok(gate >= 0 && gate < BRIDGE.indexOf('function reloadWidgetsOnLeave'));
  // No timer: one call on the background event, nothing scheduled.
  const body = BRIDGE.slice(BRIDGE.indexOf('function reloadWidgetsOnLeave'), BRIDGE.indexOf('async function shareWidgetData'));
  assert.ok(!/setTimeout|setInterval/.test(body));
});

test('old builds: reloadWidgets is native since build 201 and the JavaScript call never throws', () => {
  assert.match(NATIVE, /Function\("reloadWidgets"\)/);
  assert.match(MOD, /reloadWidgets\(kind\?: string\) \{ try \{ native\?\.reloadWidgets\(kind \|\| null\); \} catch \{\} \}/);
});
