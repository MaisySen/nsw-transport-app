// Runs the API locally under wrangler dev against the fake Transport for NSW (tools/fake-nsw.mjs), for break it
// passes and journeys with no production key and no cost (docs/REVERSE_ENGINEERING.md, g28).
//   node backend/tools/local-dev.mjs <work dir> [api port 8787] [fake port 8799]
// Needs wrangler 4 on PATH or in <work dir>/node_modules (npm i wrangler@4 there). Builds the worker into
// <work dir>/dist with the Transport for NSW address swapped for the fake, writes a local wrangler.toml (no routes,
// no account, local D1, no email) and placeholder secrets, applies the D1 migrations locally, then starts both.
// The swapped build is never deployed: it lives outside the repo and its address is 127.0.0.1.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const backend = path.resolve(new URL("..", import.meta.url).pathname);
const work = path.resolve(process.argv[2] || "");
if (!process.argv[2] || work.startsWith(path.resolve(backend, ".."))) {
  console.error("Give a work dir outside the repo: node backend/tools/local-dev.mjs /tmp/tsl-local");
  process.exit(2);
}
const apiPort = +(process.argv[3] || 8787), fakePort = +(process.argv[4] || 8799);
fs.mkdirSync(work, { recursive: true });
execFileSync(process.execPath, [path.join(backend, "build.mjs"), "--cloudflare", path.join(work, "dist")], { stdio: "inherit" });
const wf = path.join(work, "dist", "worker.mjs");
const src = fs.readFileSync(wf, "utf8");
const real = '"https://api.transport.nsw.gov.au"';
if (!src.includes(real)) throw new Error("Transport for NSW address not found in the build");
fs.writeFileSync(wf, src.split(real).join(`"http://127.0.0.1:${fakePort}"`));

let toml = fs.readFileSync(path.join(backend, "wrangler.toml.template"), "utf8");
toml = toml.replace(/^account_id = .*\n/m, "")
  .replace('CF_ACCOUNT_ID = "${CF_ACCOUNT_ID}"', 'CF_ACCOUNT_ID = "local"')
  .split("${D1_DATABASE_ID}").join("00000000-0000-0000-0000-000000000000")
  .split("${R2_BLOCK}").join("")
  .replace(/\[\[routes\]\][^[]*?custom_domain = true\n/g, "")
  .replace(/\[\[send_email\]\]\nname = "ALERT_EMAIL"\ndestination_address = "[^"]*"\n/, "")
  .replace('migrations_dir = "migrations"', `migrations_dir = "${path.join(backend, "migrations")}"`);
if (/\$\{[A-Z_]+\}/.test(toml)) throw new Error("wrangler.toml.template has a value this script does not fill: " + toml.match(/\$\{[A-Z_]+\}/)[0]);
fs.writeFileSync(path.join(work, "wrangler.toml"), toml);
fs.writeFileSync(path.join(work, ".dev.vars"), "TFNSW_API_KEY=fake-local-key\nADMIN_KEY=local-admin-key\nTICK_KEY=local-tick\nVAPID_PUBLIC_KEY=x\nVAPID_PRIVATE_KEY=x\n");

const local = path.join(work, "node_modules", ".bin", "wrangler");
const wrangler = fs.existsSync(local) ? local : "wrangler";
execFileSync(wrangler, ["d1", "migrations", "apply", "DB", "--local"], { cwd: work, stdio: "inherit" });
const fake = spawn(process.execPath, [path.join(backend, "tools", "fake-nsw.mjs"), String(fakePort)], { stdio: "inherit" });
const dev = spawn(wrangler, ["dev", "--port", String(apiPort), "--ip", "127.0.0.1", "--local", "--test-scheduled"], { cwd: work, stdio: "inherit" });
const stop = () => { fake.kill(); dev.kill(); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
dev.on("exit", () => { fake.kill(); process.exit(0); });
console.log(`API on http://127.0.0.1:${apiPort}, fake Transport for NSW on http://127.0.0.1:${fakePort} (/__mode?set=429)`);
