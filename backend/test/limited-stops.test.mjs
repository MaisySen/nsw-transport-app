// Limited Stops from the timetable (tools/limited_stops.py, used by tools/build_planner.py). Small hand made lines:
// an all stops train with an express that skips three stations, a branch that is not a skip, a ferry that skips one
// wharf, a bus detour (not limited), a bus that skips stops on several stretches (limited), a line where only a few
// one off trips stop at a station, and the timetable's own "Limited stops" and "Express" names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const tools = new URL("../tools/", import.meta.url).pathname;
function run(cases) {
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(tools)})
from limited_stops import limited_patterns, is_limited, name_says_limited
cases = json.loads(sys.stdin.read())
out = {}
for name, pats in cases.items():
    res = limited_patterns([(p[0], p[1], p[2], p[3]) for p in pats])
    out[name] = [i for i, (n, g, sv) in res.items() if is_limited(pats[i][1], n, g, sv)]
print(json.dumps(out))
`;
  return JSON.parse(execFileSync("python3", ["-c", py], { input: JSON.stringify(cases) }).toString());
}
const seq = (s) => s.split(" ");

test("trains, metro, light rail and ferries: one skipped station on the line's own stretch is limited", () => {
  const r = run({
    train: [
      ["L1", 1, seq("A B C D E F"), 12],      // all stations
      ["L1", 1, seq("A B F"), 6],             // runs past C, D and E
      ["L1", 1, seq("F E D C B A"), 12],      // the other way, all stations
      ["L1", 1, seq("F C B A"), 4],           // the other way, past E and D
      ["L1", 1, seq("A B C D"), 5],           // a short working, all stations: not limited
    ],
    branch: [
      ["L2", 1, seq("P Q R S"), 10],
      ["L2", 1, seq("P Q T U"), 10],          // another branch after Q: nothing skipped
    ],
    ferry: [
      ["F9", 9, seq("W1 W2 W3 W4"), 9],
      ["F9", 9, seq("W1 W3 W4"), 3],          // past W2
    ],
    lightrail: [
      ["LR", 4, seq("K1 K2 K3 K4 K5"), 30],
      ["LR", 4, seq("K1 K2 K3 K4 K5"), 2],
    ],
  });
  assert.deepEqual(r.train.sort(), [1, 3]);
  assert.deepEqual(r.branch, []);
  assert.deepEqual(r.ferry, [1]);
  assert.deepEqual(r.lightrail, []);
});

test("a stop only a few one off trips make is not a stop the line normally serves", () => {
  const r = run({
    rare: [
      ["L3", 1, seq("A B D"), 20],
      ["L3", 1, seq("A B C D"), 2],           // C served by 2 of 22 trips: the 20 others are not limited
    ],
    lines: [
      ["L4", 1, seq("A B C"), 8],
      ["L5", 1, seq("A C"), 8],               // another line past B: the line's own pattern is the reference
    ],
  });
  assert.deepEqual(r.rare, []);
  assert.deepEqual(r.lines, []);
});

test("buses: a detour on one stretch is not limited, skips on several stretches are", () => {
  const all = seq("s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12");
  const r = run({
    detour: [
      ["100", 5, all, 20],
      ["100", 5, seq("s1 s2 s3 s4 s7 s8 s9 s10 s11 s12"), 10],   // leaves out s5 and s6 on one stretch
    ],
    limited: [
      ["200", 5, all, 20],
      ["200", 5, seq("s1 s4 s7 s10 s12"), 10],                    // past 7 stops on 4 stretches
    ],
    few: [
      ["300", 5, all, 2],
      ["300", 5, seq("s1 s4 s7 s10 s12"), 1],                     // too few trips to know what the line serves
    ],
  });
  assert.deepEqual(r.detour, []);
  assert.deepEqual(r.limited, [1]);
  assert.deepEqual(r.few, []);
});

test("the timetable's own name: Limited stops and Express count, other words do not", () => {
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(tools)})
from limited_stops import name_says_limited
print(json.dumps([name_says_limited(t) for t in ["Bankstown to Sydenham (Limited stops)", "City to Castle Hill (Express Service)", "Northmead HS express to Parramatta Station", "Penrith via Parramatta", "M4 Motorway to Expressway Rd", ""]]))
`;
  assert.deepEqual(JSON.parse(execFileSync("python3", ["-c", py]).toString()), [true, true, true, false, false, false]);
});
