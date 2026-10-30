// Counts how many tests mention the owner's own stations (rule: at most 5%).
// A test mentions a station when its own source (name and body) names one of
// the stations or stop ids below, or uses a top level constant, function or
// fixture file of its test file that does. Used by
// backend/test/owner-stations.test.mjs and runnable by hand:
//   node backend/tools/owner-stations.mjs        (prints the count)
//   node backend/tools/owner-stations.mjs --list (also lists each test)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const LIMIT = 0.05;

// A test that lists the stations only to check they are absent (from source code,
// or from a sample) carries this mark in a comment and is not counted as a mention.
export const GUARD_MARK = "owner-stations: guard";

export const OWNER_NAMES = [
  "Strathfield", "Burwood", "Kings Cross", "Redfern", "Town Hall",
  "Flemington", "Campsie", "Five Dock", "Chiswick",
];
export const OWNER_IDS = ["213510", "213516", "201110", "214020", "219410"];

const nameRe = OWNER_NAMES.map((n) => n.split(" ").join("[\\s_-]*")).join("|");
const OWNER_RE = new RegExp(`(?:${nameRe})|(?<![0-9])(?:${OWNER_IDS.join("|")})(?![0-9])`, "i");

export function mentionsOwner(text) {
  return OWNER_RE.test(text);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEST_DIRS = [join(ROOT, "app", "test"), join(ROOT, "backend", "test")];

const KEYWORDS_BEFORE_REGEX = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await",
]);

// Splits JS source into code with strings, templates, regexes and comments
// replaced by spaces (same length), so brackets and names can be found safely.
export function maskSource(src) {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  let lastSig = ""; // last significant code char or word
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  const tplStack = []; // brace depth when a template ${ was entered
  let braceDepth = 0;
  const readTemplate = () => {
    // i at char after the opening backtick or after a closing } of ${...}
    const start = i;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { blank(start, i); i++; lastSig = "x"; return; }
      if (c === "$" && src[i + 1] === "{") {
        blank(start, i + 2); i += 2; tplStack.push(braceDepth); braceDepth++; lastSig = "{"; return;
      }
      i++;
    }
    blank(start, n);
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { const s = i; while (i < n && src[i] !== "\n") i++; blank(s, i); continue; }
    if (c === "/" && d === "*") { const s = i; const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; blank(s, i); continue; }
    if (c === "'" || c === '"') {
      const s = i; i++;
      while (i < n && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") i++; i++; }
      i++; blank(s + 1, i - 1); lastSig = "x"; continue;
    }
    if (c === "`") { i++; readTemplate(); continue; }
    if (c === "/") {
      const isRegex = lastSig === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSig) || KEYWORDS_BEFORE_REGEX.has(lastSig);
      if (isRegex) {
        const s = i; i++; let inClass = false;
        while (i < n && src[i] !== "\n") {
          if (src[i] === "\\") { i += 2; continue; }
          if (src[i] === "[") inClass = true; else if (src[i] === "]") inClass = false;
          else if (src[i] === "/" && !inClass) break;
          i++;
        }
        i++; while (i < n && /[a-z]/i.test(src[i])) i++;
        blank(s + 1, i); lastSig = "x"; continue;
      }
      lastSig = "/"; i++; continue;
    }
    if (c === "{") { braceDepth++; lastSig = "{"; i++; continue; }
    if (c === "}") {
      if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth - 1) {
        tplStack.pop(); braceDepth--; out[i] = " "; i++; readTemplate(); continue;
      }
      braceDepth--; lastSig = "}"; i++; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const s = i; while (i < n && /[\w$]/.test(src[i])) i++;
      lastSig = src.slice(s, i); continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    lastSig = c; i++;
  }
  return out.join("");
}

function matchClose(masked, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let k = open; k < masked.length; k++) {
    const c = masked[k];
    if (c in pairs) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      stack.pop();
      if (!stack.length) return k;
    }
  }
  return masked.length - 1;
}

// Every test( / it( call (with .skip, .only, .todo) and its source. The suites use
// no subtests (t.test), and a regex's .test( is not a test.
export function findTests(src) {
  const masked = maskSource(src);
  const re = /(?<![\w$.])(?:test|it)(?:\.(?:skip|only|todo))?\s*\(/g;
  const tests = [];
  let m;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(masked, open);
    tests.push({ start: m.index, end: close + 1, text: src.slice(m.index, close + 1) });
  }
  return { masked, tests };
}

// Top level code of a test file. Returns the names of top level declarations
// (const/let/var/function/class) whose source names an owner station or an owner
// fixture file, and whether any other top level statement (a fake fetch set up for
// every test, say) does, which makes every test in the file count.
function ownerTopLevel(src, masked, fixtures = new Map()) {
  const names = new Set();
  let fileWide = false;
  let depth = 0;
  const decl = /^(?:export\s+)?(?:const|let|var|async\s+function\*?|function\*?|class)\s+([A-Za-z_$][\w$]*)/;
  const skip = /^(?:import\b|(?:test|it|describe)(?:\.\w+)?\s*\(|\s|$)/;
  const mentions = (text) => mentionsOwner(text) || [...fixtures.keys()].some((fx) => text.includes(fx));
  for (let k = 0; k < masked.length; k++) {
    const c = masked[k];
    if (c === "{" || c === "(" || c === "[") { depth++; continue; }
    if (c === "}" || c === ")" || c === "]") { depth--; continue; }
    if (depth !== 0) continue;
    if (k > 0 && masked[k - 1] !== "\n") continue;
    const head = masked.slice(k, k + 200);
    const m = decl.exec(head);
    if (!m && skip.test(head)) continue;
    // the statement runs to the next top level ; or to the next line that starts a new statement
    let e = k; let dd = 0;
    for (; e < masked.length; e++) {
      const ch = masked[e];
      if (ch === "{" || ch === "(" || ch === "[") dd++;
      else if (ch === "}" || ch === ")" || ch === "]") dd--;
      else if (dd === 0 && ch === ";") { e++; break; }
      else if (dd === 0 && ch === "\n" && e > k && /^[A-Za-z_$]/.test(masked[e + 1] || "")) break;
    }
    const text = src.slice(k, e);
    if (!mentions(text)) continue;
    if (m) names.add(m[1]); else fileWide = true;
  }
  return { names, fileWide };
}

function fixtureFiles(dir) {
  const out = new Map();
  const fx = join(dir, "fixtures");
  if (!existsSync(fx)) return out;
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else { try { if (mentionsOwner(readFileSync(p, "utf8"))) out.set(ent.name, p); } catch {} }
    }
  };
  walk(fx);
  return out;
}

export function countOwnerTests(dirs = TEST_DIRS) {
  const rows = [];
  const guards = [];
  let total = 0;
  for (const dir of dirs) {
    const fixtures = fixtureFiles(dir);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".test.mjs")).sort()) {
      const path = join(dir, f);
      const src = readFileSync(path, "utf8");
      const { masked, tests } = findTests(src);
      const { names: bindings, fileWide } = ownerTopLevel(src, masked, fixtures);
      for (const t of tests) {
        total++;
        if (t.text.includes(GUARD_MARK)) { guards.push(`${basename(dirname(dir))}/test/${f}`); continue; }
        let why = null;
        if (mentionsOwner(t.text)) why = "names a station";
        else if (fileWide) why = "file setup names a station";
        else {
          for (const b of bindings) if (new RegExp(`(?<![\\w$])${b.replace(/\$/g, "\\$")}(?![\\w$])`).test(t.text)) { why = `uses ${b}`; break; }
          if (!why) for (const fx of fixtures.keys()) if (t.text.includes(fx) || t.text.includes(fx.replace(/\.json$/, ""))) { why = `uses fixture ${fx}`; break; }
        }
        if (why) {
          const line = src.slice(0, t.start).split("\n").length;
          rows.push({ file: `${basename(dirname(dir))}/test/${f}`, line, why, name: t.text.slice(0, 90).split("\n")[0] });
        }
      }
    }
  }
  return { total, owner: rows.length, share: total ? rows.length / total : 0, rows, guards };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = countOwnerTests();
  console.log(`${r.owner} of ${r.total} tests mention an owner station (${(r.share * 100).toFixed(2)}%, limit ${LIMIT * 100}%); ${r.guards.length} guard tests not counted`);
  if (process.argv.includes("--list")) for (const x of r.rows) console.log(`${x.file}:${x.line}  ${x.why}  ${x.name}`);
}
