// Hooks order (29 Oct): crash reports from build 208 (update 01a17d5a, 28 Oct, two phones) all read "Rendered more
// hooks than during the previous render" in OpalFareCard on the trip screen: it returned early when a trip had no fare
// yet, before its useState, so the render after the fare arrived ran one hook more and the error screen showed.
// This walks every component in src with the TypeScript parser and fails when a hook call comes after a statement that
// can return early, or sits inside a condition or loop of the component body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules', 'typescript'));

const isHook = (n) => /^use[A-Z0-9]/.test(n);
const isComp = (n) => /^[A-Z]/.test(n || '');

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

// Hook calls inside node, not counting nested functions (callbacks may call hooks only if they are components, which
// are checked on their own).
function hookCalls(node, sf) {
  const found = [];
  const walk = (n) => {
    if (n !== node && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n))) return;
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) ? e.name.text : '';
      if (isHook(name)) found.push(name + ' line ' + (sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1));
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}
function returns(node) {
  let r = false;
  const walk = (n) => {
    if (r) return;
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) return;
    if (ts.isReturnStatement(n)) { r = true; return; }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return r;
}

function check(body, name, sf, rel, bad) {
  let early = null;
  for (const s of body.statements) {
    const hooks = hookCalls(s, sf);
    const conditional = ts.isIfStatement(s) || ts.isForStatement(s) || ts.isForOfStatement(s) || ts.isForInStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s) || ts.isSwitchStatement(s);
    // A try block runs on every render (ErrorBoundary reads usePathname inside one), so it is not a condition.
    if (hooks.length && early) bad.push(`${rel} ${name}: ${hooks[0]} after an early return on line ${early}`);
    else if (hooks.length && conditional) bad.push(`${rel} ${name}: ${hooks[0]} inside a condition or loop`);
    if (!early && !ts.isReturnStatement(s) && returns(s)) early = sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1;
  }
}

function scan() {
  const bad = [];
  for (const f of files(path.join(root, 'src'))) {
    const rel = path.relative(root, f);
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.ES2022, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n) => {
      let name = null, fn = null;
      if (ts.isFunctionDeclaration(n) && n.name) { name = n.name.text; fn = n; }
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) { name = n.name.text; fn = n.initializer; }
      if (fn && fn.body && ts.isBlock(fn.body) && (isComp(name) || isHook(name))) check(fn.body, name, sf, rel, bad);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return bad;
}

test('hooks order: no hook after an early return or inside a condition, in any component or hook in src', () => {
  assert.deepEqual(scan(), []);
});

test('hooks order: OpalFareCard keeps its state hook above the no fare return', () => {
  const s = fs.readFileSync(path.join(root, 'src/app/trip.tsx'), 'utf8');
  const body = s.slice(s.indexOf('function OpalFareCard('));
  const hook = body.indexOf('useState(false)'), ret = body.indexOf('if (!f) return null');
  // useState(false) is OpalFareCard's own expand state; it must be read before the return.
  assert.ok(hook > 0 && ret > 0 && hook < ret);
});
