// Loads a trip planner pack (tools/build_planner.py) into our own planner (src/raptor.js) at api.transportsydney.app.
//   ENGINE_LOAD_KEY=... node tools/load_planner.mjs <pack file> [api base]
// The pack goes up as parts of 1 MB (the header and each array on its own), then commit switches the planner to it
// in one step, so a search never mixes two packs. Replicas (OWN_PLANNER_REPLICAS) then copy it from the first object.
import fs from "node:fs";

const file = process.argv[2];
const base = (process.argv[3] || "https://api.transportsydney.app").replace(/\/$/, "");
const key = process.env.ENGINE_LOAD_KEY || process.env.ADMIN_KEY;
if (!file || !key) { console.error("usage: ENGINE_LOAD_KEY=... node tools/load_planner.mjs <pack file> [api base]"); process.exit(2); }
const buf = fs.readFileSync(file);
if (buf.subarray(0, 4).toString() !== "RPK1") { console.error("not a planner pack"); process.exit(2); }
const hl = buf.readUInt32LE(4);
const head = JSON.parse(buf.subarray(8, 8 + hl).toString("utf8"));
const at = 8 + hl;
const ver = Math.floor(Date.now() / 1000);
const PART = 1 << 20;

async function post(path, body) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(base + "/api/raptor/load/" + path, { method: "POST", headers: { "x-admin-key": key, "content-type": "application/octet-stream" }, body });
      const t = await r.text();
      if (r.ok) return JSON.parse(t);
      if (r.status < 500) throw new Error(path + " answered " + r.status + " " + t.slice(0, 200));
    } catch (e) { if (i === 3 || /answered 4/.test(String(e.message))) throw e; }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}
async function send(name, bytes) {
  for (let i = 0, o = 0; o < bytes.length || i === 0; i++, o += PART) await post(`part?ver=${ver}&part=${name}&i=${i}`, bytes.subarray(o, o + PART));
}
const t0 = Date.now();
await post(`begin?ver=${ver}`, "");
await send("head", Buffer.from(JSON.stringify(head), "utf8"));
for (const a of head.arrays) {
  const size = a.length * (a.type === "u8" ? 1 : 4);
  await send(a.name, buf.subarray(at + a.offset, at + a.offset + size));
  process.stdout.write(".");
}
const c = await post(`commit?ver=${ver}`, "");
console.log("\nloaded", file, "day", head.day, "ver", ver, "in", Math.round((Date.now() - t0) / 1000), "s:", JSON.stringify(c));
const r = await fetch(base + "/api/raptor/replicas", { method: "POST", headers: { "x-admin-key": key } }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
console.log("replicas", JSON.stringify(r));
