// Renders wrangler.toml from wrangler.toml.template with values from the environment.
// CF_ACCOUNT_ID and D1_DATABASE_ID are required; R2_BUCKET is optional (the Android APK download).
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const need = (k) => { const v = process.env[k]; if (!v || !/^[A-Za-z0-9-]+$/.test(v)) { console.error(`Set ${k} (letters, digits and dashes only)`); process.exit(1); } return v; };
const vals = { CF_ACCOUNT_ID: need("CF_ACCOUNT_ID"), D1_DATABASE_ID: need("D1_DATABASE_ID") };
const bucket = process.env.R2_BUCKET;
if (bucket && !/^[a-z0-9-]{3,63}$/.test(bucket)) { console.error("R2_BUCKET must be a bucket name"); process.exit(1); }
vals.R2_BLOCK = bucket ? `\n# Android APK for /download/transport.apk\n[[r2_buckets]]\nbinding = "FILES"\nbucket_name = "${bucket}"\n` : "";
let t = fs.readFileSync(path.join(root, "wrangler.toml.template"), "utf8");
t = t.replace(/\$\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
if (/\$\{\w+\}/.test(t)) { console.error("wrangler.toml still has a placeholder"); process.exit(1); }
fs.writeFileSync(path.join(root, "wrangler.toml"), t);
console.log("Wrote wrangler.toml" + (bucket ? " with R2 bucket " + bucket : " without R2 (APK download answers 503)"));
