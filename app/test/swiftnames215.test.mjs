// Build 215 check (2 Nov 2026): one name per top-level Swift type in each native target. The Mac compile of build-215-rc
// (native audit run 41398618091, module job) failed with "invalid redeclaration of 'IslandMinimal'": fix-island-2nov
// added enum IslandMinimal (IslandMinimal.swift) to the widget target, which already had the follow activity's
// struct IslandMinimal (TripLiveActivity.swift). Linux cannot compile SwiftUI, so this reads the sources: every
// top-level struct, enum, class, actor, protocol and typealias of a target's files, and no name twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const swiftFiles = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...swiftFiles(p));
    else if (e.name.endsWith('.swift')) out.push(p);
  }
  return out;
};
// Top-level declarations only: at the start of a line (no indent), outside #if blocks' alternatives is not modelled,
// so a name declared once per #if branch counts once per file.
function topLevel(file) {
  const names = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|fileprivate|final|open)\s+)*(struct|enum|class|actor|protocol|typealias)\s+([A-Za-z_]\w*)/);
    if (m && !/^(?:private|fileprivate)\b/.test(line.replace(/^(?:@\w+(?:\([^)]*\))?\s+)*/, ''))) names.add(m[2]);
  }
  return names;
}
const TARGETS = { widget: 'targets/widget', watch: 'targets/watch', module: 'modules/transport-ios/ios' };

for (const [name, dir] of Object.entries(TARGETS)) {
  test(`no top-level Swift type declared twice in the ${name} target`, () => {
    const seen = new Map();
    const dup = [];
    for (const f of swiftFiles(path.join(root, dir))) {
      for (const n of topLevel(f)) {
        const rel = path.relative(root, f);
        if (seen.has(n)) dup.push(`${n}: ${seen.get(n)} and ${rel}`); else seen.set(n, rel);
      }
    }
    assert.deepEqual(dup, []);
  });
}
