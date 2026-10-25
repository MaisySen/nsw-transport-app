// Build 207 native items for iOS 26 and 27 (docs/IOS27.md): the Liquid Glass app icon and widget line badges that
// stay readable on tinted and clear Home Screens and the Lock Screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('iOS app icon is an Icon Composer .icon with its layer image present', () => {
  const app = JSON.parse(read('app.json')).expo;
  assert.equal(app.ios.icon, './assets/transport.icon');
  const icon = JSON.parse(read('assets/transport.icon/icon.json'));
  const layers = icon.groups.flatMap((g) => g.layers);
  assert.ok(layers.length >= 1);
  for (const l of layers) assert.ok(fs.existsSync(path.join(root, 'assets/transport.icon/Assets', l['image-name'])), l['image-name']);
  assert.ok(icon.fill, 'background fill set');
  // Android and the web keep the flat icon.
  assert.equal(app.icon, './assets/images/icon.png');
});

test('widget line badge has a non full colour form', () => {
  const s = read('targets/widget/TransportWidgets.swift');
  const badge = s.slice(s.indexOf('struct WidgetLineBadge'), s.indexOf('struct WaitText'));
  assert.match(badge, /@Environment\(\\\.widgetRenderingMode\)/);
  assert.match(badge, /renderingMode == \.fullColor/);
  assert.match(badge, /strokeBorder/);
});

test('widget line badges look the same everywhere: official colour, buses always bus blue, no glyph inside', () => {
  const s = read('targets/widget/TransportWidgets.swift');
  const badge = s.slice(s.indexOf('struct WidgetLineBadge'), s.indexOf('struct WaitText'));
  assert.doesNotMatch(badge, /Image\(systemName/, 'no mode glyph inside the badge');
  assert.match(badge, /case \.bus, \.school: return Mode\.bus\.fallbackHex/, 'buses are bus blue even with no live data');
  assert.match(badge, /grey \? m\.fallbackHex/, 'a grey colour from the server falls back to the mode colour');
  assert.doesNotMatch(badge, /large \?/, 'one size');
});
