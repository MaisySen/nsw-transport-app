// Sets up Cloudflare Email Routing for transportsydney.app: support@, privacy@ and hello@ forward to
// contact@fintex.au, plus the DNS records (MX, SPF, DKIM from Email Routing; DMARC added here).
// Safe to run again. Needs CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID. Usage: node tools/setup-email.mjs [--dry-run]
// The first run sends a verification email to the destination; forwarding starts once it is clicked.
const DOMAIN = "transportsydney.app";
const DEST = process.env.EMAIL_DESTINATION || "contact@fintex.au";
const BOXES = ["support", "privacy", "hello"];
const DMARC = `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:${DEST}`;
const DRY = process.argv.includes("--dry-run");
const { CLOUDFLARE_API_TOKEN: TOKEN, CF_ACCOUNT_ID: ACC, CF_ZONE_ID: ZONE } = process.env;
if (!TOKEN || !ACC || !ZONE) { console.error("Set CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID and CF_ZONE_ID"); process.exit(1); }

async function cf(method, p, body) {
  if (DRY && method !== "GET") { console.log("  would " + method + " " + p); return { success: true, result: {} }; }
  const r = await fetch("https://api.cloudflare.com/client/v4" + p, { method, headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ success: false, errors: [{ message: "HTTP " + r.status }] }));
  if (!j.success) throw new Error(method + " " + p + ": " + (j.errors || []).map((e) => e.code + " " + e.message).join("; "));
  return j;
}

console.log("1. Email Routing on, with its MX, SPF and DKIM records");
const st = (await cf("GET", `/zones/${ZONE}/email/routing`)).result || {};
if (!st.enabled) await cf("POST", `/zones/${ZONE}/email/routing/dns`, {});

console.log("2. Destination " + DEST);
const dests = (await cf("GET", `/accounts/${ACC}/email/routing/addresses?per_page=50`)).result || [];
let dest = dests.find((d) => d.email.toLowerCase() === DEST.toLowerCase());
if (!dest) { await cf("POST", `/accounts/${ACC}/email/routing/addresses`, { email: DEST }); dest = { verified: null }; }
console.log(dest.verified ? "  verified" : `  NOT VERIFIED YET: open the email Cloudflare sent to ${DEST} and click Verify email address`);

console.log("3. Forwarding rules");
const rules = (await cf("GET", `/zones/${ZONE}/email/routing/rules?per_page=50`)).result || [];
for (const box of BOXES) {
  const to = `${box}@${DOMAIN}`;
  if (rules.some((r) => (r.matchers || []).some((m) => m.value === to))) continue;
  await cf("POST", `/zones/${ZONE}/email/routing/rules`, { name: to, enabled: true, matchers: [{ type: "literal", field: "to", value: to }], actions: [{ type: "forward", value: [DEST] }] });
}

console.log("4. DMARC");
const dm = (await cf("GET", `/zones/${ZONE}/dns_records?type=TXT&name=_dmarc.${DOMAIN}`)).result || [];
if (!dm.some((r) => /^"?v=DMARC1/.test(r.content))) await cf("POST", `/zones/${ZONE}/dns_records`, { type: "TXT", name: `_dmarc.${DOMAIN}`, content: DMARC, ttl: 1, comment: "DMARC" });

console.log("5. Records now in the zone for mail:");
for (const t of ["MX", "TXT"]) {
  for (const r of (await cf("GET", `/zones/${ZONE}/dns_records?type=${t}&per_page=100`)).result || []) {
    if (t === "TXT" && !/spf1|DMARC1|DKIM1|p=/.test(r.content)) continue;
    console.log(`  ${r.type} ${r.name} ${t === "MX" ? r.priority + " " : ""}${r.content.slice(0, 80)}`);
  }
}
