// A small Cloudflare D1 stand in on node:sqlite, so tests run real SQL (claims, conflicts,
// deletes) instead of string matching. Only what the worker uses: prepare, bind, run, all,
// first and batch.
import { DatabaseSync } from "node:sqlite";

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  const norm = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a.map(norm)),
    run: async () => {
      const r = db.prepare(q).run(...args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    all: async () => ({ results: db.prepare(q).all(...args).map((x) => ({ ...x })) }),
    first: async () => { const r = db.prepare(q).get(...args); return r ? { ...r } : null; },
  });
  return {
    sql: db,
    prepare: (q) => stmt(q),
    batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; },
  };
}
