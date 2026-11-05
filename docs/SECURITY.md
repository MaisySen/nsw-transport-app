# Security

Where every secret lives, by name only, and the rules that keep them out of the code. No secret value appears in this repository. Updated 5 Nov 2026 (security review below); earlier 24 Oct 2026; inventory brought up to date 26 Oct, 4:30 PM (the full list with rotation steps is [RUNBOOK.md](RUNBOOK.md) section 11).

## Rules

1. No secret in git, commit messages, issues, screenshots or logs. The repo is public.
2. The backend source holds placeholders (`__TFNSW_API_KEY__` and so on). `backend/build.mjs` fills them in at build time from `backend/.env`, which is ignored by git.
3. Values only ever go into the server side `worker.mjs`. The web app, the Android app and the iPhone app hold no secrets. `backend/test/site.test.mjs` checks that no API key is in the public files or the source.
4. Owner credentials are sent to Bidur by email at the owner's ops email (the address is in the operator notes, not here), organised by service, and resent in full whenever one is created, changed or revoked.
5. Rotate a secret the moment it may have leaked. Steps per secret: [Runbook, section 11](RUNBOOK.md#11-credentials-list-where-each-lives-rotation).

## Secret inventory

| Secret | What it protects | Where it lives |
| --- | --- | --- |
| `TFNSW_API_KEY` | Transport for NSW Open Data API (Bronze plan, 60,000 calls a day) | `backend/.env` on the build box; inside the deployed worker |
| `VAPID_PRIVATE_KEY` | Signs Web Push notifications | `backend/.env`; deployed worker |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | Public by design, served at `/api/push/key` | `backend/.env`; deployed worker |
| `TICK_KEY` | Lets the scheduler call `/api/tick` | `backend/.env`; deployed worker; the cron-job.org job URL |
| `ADMIN_KEY` | Admin and test endpoints: `/api/stats`, `/api/feedback` (read), `/api/admin/*`, forced ticks | `backend/.env`; deployed worker |
| Transport for NSW Open Data login | The account that owns the API key | Credentials email; build box secrets folder |
| Expo account login and access token | EAS Update and EAS builds (account `bidurtab`) | Credentials email; build box secrets folder; `EXPO_TOKEN` in the build environment |
| cron-job.org login and API key | The minute scheduler job | Credentials email; build box secrets folder |
| Android upload keystore (`nsw-transport-release.jks`, alias `nswtransport`) and its passwords | Signs every Android APK and AAB. Losing it means a Play upload key reset | `~/.nsw-secrets/` on the build box (`nsw-transport-release.jks`, `android-keystore.json`); a copy was emailed to Bidur |
| Appetize login and API token | Android emulator previews in the browser (free minutes used up) | Credentials email; `~/.nsw-secrets/appetize.json` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` | App Store Connect API key for builds, TestFlight upload and metadata | GitHub Actions repository secrets; operator copy in `~/.nsw-secrets/` (`asc.json` and the `.p8`) |
| Play service account key | Command line Play uploads (`store/play-upload.mjs`) | `~/.nsw-secrets/play-service-account.json` on the build machine (the Play app itself does not exist yet) |
| GitHub | Repository access | Bidur's own account `MaisySen`, connected to the build machine by authorization. No password or token stored in the project |
| contact@fintex.au | Fintex mailbox for sign ups, resets and store invites; support@, privacy@ and hello@transportsydney.app forward to it | Fintex's own mailbox |
| Cloudflare | Fintex Australia account: API Worker, D1, Pages, DNS, Email Routing | Deploy token in `~/.nsw-secrets/cloudflare.json`, passed as `CLOUDFLARE_API_TOKEN`; dashboard login with TOTP 2FA (seed in `~/.nsw-secrets/cloudflare-2fa.json`); never in the repo |
| Cloudflare analytics token | Read only usage (Account Analytics Read): `tools/orient.mjs` and the budget guard | Worker secret `CF_ANALYTICS_TOKEN`; `~/.nsw-secrets/cloudflare-analytics.json` |
| `ENGINE_LOAD_KEY` | Loads timetable and planner packs into the engine | Worker secret; GitHub Actions secret `ENGINE_LOAD_KEY` |
| `TFNSW_API_KEY` (repo secret) | The nightly timetable workflow | GitHub Actions secret, same value as the Worker secret |
| `OWNER_STATIONS` | The owner's own stations for the owner stations test guard (not a credential, but it says where the owner lives and works, so it is not in the repository since 5 Nov 2026) | GitHub Actions secret `OWNER_STATIONS`, JSON `{"names": [...], "ids": [...]}`; or `backend/tools/owner-stations.local.json` on the build box (ignored by git) |

Admin and scheduler keys go in an `x-admin-key` header, and only there: the server no longer reads a `?key=` query form (checked 5 Nov 2026, `keyOk` in `backend/src/worker.js`). Treat any old URL that contains one as a secret anyway and do not share it or paste it into a chat.

## Data the service keeps

* No accounts, names, emails (except an optional email on the contact form) or advertising IDs.
* Each install has a random profile id. Saved trips, commutes, searches and watches are stored per profile or device.
* Trip searches are deleted after 90 days, finished watches after 30 days.
* The page counter keeps one total per day, page and referring site. No cookies, IP addresses or browser details. Do Not Track and Global Privacy Control are respected.
* Rate limits keep a count per address (an IPv6 /64 as one) for one minute in `ip_rate`, deleted by the minute cron; the privacy policy says so.
* Push subscriptions and Expo tokens are stored per device and removed when they fail or the user turns alerts off.

The full policy is at https://transportsydney.app/privacy/ and in [store/privacy-policy.md](../store/privacy-policy.md).

## Reporting a problem

Email contact@fintex.au, or use GitHub private vulnerability reporting on this repo (it is switched on).

## Security review, 5 Nov 2026

Scope: this repo at main `ffacffa` (backend/, app/, site/, store/, .github/workflows, the full git history of 612 commits). Read only against production: nothing was sent to the live server or to Transport for NSW. Fixes are in the pull request from branch `audit-fixes-2026-11-05`; the server parts take effect at the next Worker deploy, the app parts at the next over the air update, the native parts (widget and Watch clocks) at the next build.

No secret has leaked: no key, token, keystore, .p8, .env or service account file in any commit; only test keys. No admin bypass, SQL injection, XSS or open redirect was found. The serious findings were about abuse and cost, all reachable without a key.

| Id | Severity | Finding | Fix |
| --- | --- | --- | --- |
| H1 | High | Trip card registrations (`/api/live-activity`, `/api/apns/device`) had no rate limit. Each new card cost up to about 10 Trip Planner calls a pass, outside the daily safety cap, so posted made up tokens could spend the 60,000 a day quota in about 20 minutes and push real cards out of the pass | 40 in 10 minutes per address and 60 a minute shared; a card Apple has not taken a push for uses the quick answer only (no Trip Planner call) and at most 20 go in a pass; cards Apple has taken are read on their own |
| H2 | High | Commutes had no cap and never ended, the tick asked the planner every minute when it found nothing, and only the 25 oldest watches were ever worked on, so one script could spend the quota every day and stop everyone's alerts | 10 commutes per profile; 5 minute wait after no journey; commutes idle for 30 days skip the tick; watches least recently worked on first; 8 active watches per device; morning checks already claimed left out of the due list; car park watches 100 a minute (the live count is shared per car park) |
| M1 | Medium | Per address limits counted each IPv6 address on its own, and several write and engine routes had no limit | Limits count an IPv6 /64 as one address; limits added for trip cards, last way home, morning checks, trip alerts, `/api/trip/live`, `/api/engine/status`, `/api/timetable`, `/api/usage`, `/api/traffic`; `/api/pack` 300 per 10 minutes and 60 a minute shared |
| M2 | Medium | Any https address was accepted as a Web Push endpoint; the worker posted to it and returned the status (a host and port scanner) | Browser push services on port 443 only, at subscribe and at send |
| M3 | Medium | `/api/usage` counted the whole `obs` table before its admin check, and `/api/obs` scanned and sorted it, on every call (D1 bills rows read) | `/api/obs` admin only; the public count is kept 10 minutes |
| M4 | Medium | `/api/engine/status` was 5 Durable Object requests per call with no cache or limit | Kept 15 s per server copy, rate limited |
| M5 | Medium | The shared saved trip copy echoed the station names one request sent, so any text reached the next person asking for that trip; a concession fare answer could be served to an adult | Names are taken out of the saved copy and each request's own names put back; the fare type is part of the copy key |
| M6 | Medium | `node build.mjs` without `--cloudflare` wrote every secret into `backend/site/worker.mjs`, which git did not ignore; run from the repository root as `node backend/build.mjs site` it would delete the public site folder and fill it | The single folder build refuses any folder in the repository; the Cloudflare build only `backend/dist`; values are escaped and a left placeholder fails the build; `.gitignore` covers `worker.mjs`, `*-site.json`, `export.sql`, `backend/site/`; `deploy-site.mjs` refuses a site folder holding any of them |
| M7 | Medium | The iPhone build job ran `npx eas-cli@latest` while holding the Expo and Sentry tokens and the signing files; XcodeGen came from `releases/latest` unchecked; GitHub Actions were pinned to tags | `eas-cli@25.3.0`; XcodeGen 2.46.0 with its sha256 checked; actions pinned to commit SHAs. The build branches carry their own copy of `ios-209-local.yml` and need the same change before their next run |
| M8 | Medium | `nswtransport://profile/<id>` switched the install after one tap and lost its own id for good | The screen warns that anyone with the link can read and change those trips, keeps this phone's id and offers Switch back; ids under 16 characters are refused |
| M9 | Medium | The privacy policy said reminders never reach the server (with Alerts for my trips on, their times do), did not mention the shared trip's install ID, the station map page from the Transport for NSW website or the map tiles on the shared trip page; App Privacy and Data safety said Diagnostics was not collected while crash reports carry the install ID | Policy, App Privacy and Data safety updated (owner to approve the policy text and click Crash Data into App Store Connect); privacy manifest on main lists Crash Data as the build branches do; More shows the install ID the policy points to |
| M10 | Medium | The owner's own stations and stop ids were listed in a test tool and several docs of this public repository, labelled as home and work | The list moved to the `OWNER_STATIONS` secret or an ignored local file; the labelled lists were taken out of the current docs. Older commits, the changelog and release notes still name them: only a history rewrite or a private repository removes them (owner decision) |

Low, fixed: watch POST no longer echoes exception text; the share owner key is read from the header only; "Delete all my data" gives the install new ids; `start=1` links start a trip at once only for the phone's own trips; ids go in headers on saved trips, commutes, Ask and watch detail when the server says id-headers; the shared trip page says it was shared by someone using Transport and uses raster tiles only (the vector map files were never served there), with a tighter CSP; the old web app asks before every `?me=` switch and clears its offline API copies; workflow inputs are checked before use and `timetable.yml` has a read only token; the sampled stops no longer start with the owner's line; widget and Watch clocks follow the phone's 12 or 24 hour setting (next build); `build-android.sh` runs in its own folder; APK downloads and the timetable stand in 204 carry the security headers.

Low, open: Android in the app still reads 12 or 24 hour time from the locale (no installed module reads the system switch; needs a native module in a build). `GET /api/watch?id=` does not check the device (the id is 64 bit random; the app now sends the device, so a later server change can require it). Some device reads (`/api/watches`, morning checks, last way home) still take `device=` in the address because those routes read only the query. Profile ids from 6 characters are still accepted for old installs. Over the air updates are not code signed (needs a key kept offline and a new build). `npm audit` in app: 4 high and 14 moderate, all in Expo build tooling. Pack 404s stay uncached (27 Oct decision); `/api/stations` keeps its old header set for old apps.

Owner only: add the `OWNER_STATIONS` secret; click Diagnostics > Crash Data in App Store Connect; approve the privacy policy text before the site is published; decide on the git history and the repository's visibility; consider GitHub Environments with branch rules for the signing secrets, and a Cloudflare rate limit rule on `/api/*`.

Tests: `backend/test/audit-nov5.test.mjs` (12) and `app/test/audit1105.test.mjs` (11) cover these fixes.

## Security review, 24 Oct 2026

Scope: this repo (backend/, app/, ios-native/, store/, .github/workflows), the live site, the published Android APK, and the secret stores (checked by name only).

No secret has leaked. There were no critical or high findings. All 6 medium findings are fixed and live.

| Severity | Found | Fixed |
| --- | --- | --- |
| Critical | 0 | |
| High | 0 | |
| Medium | 6 | 6 |
| Low | 12 | 7 |

### Secrets

* gitleaks over all 37 commits: no findings.
* Every secret value held for the project was searched for in the full git history, the current tree, every public file on the live site and every file inside the published APK. None was found.
* No keystore, .p8, .p12, .pem, .env or service account file was ever committed. `worker.mjs` and the deploy manifest are not served (404).
* Keys rotated: none. Nothing was exposed.

### Medium (all fixed)

| Id | Finding | Fix |
| --- | --- | --- |
| M1 | Admin and scheduler keys compared with plain string equality, from the query string only | Constant time compare (`safeEq`); key also accepted in an `x-admin-key` header |
| M2 | No rate limits; the contact form, test pushes, watch creation and the shared TfNSW daily quota could be scripted | Per IP limits held in memory only (no IP stored): contact form and test push 5 per 10 min, watch creation 30 per 10 min, other writes 60 per 10 min, page counter 120 per 10 min, data reads 600 per min. Past the limit: 429 |
| M3 | No Content Security Policy or other security headers | API answers carry CSP, frame-ancestors, nosniff, Referrer-Policy, HSTS and X-Frame-Options. Every page carries a CSP that allows only this site's scripts plus a hash of each inline script, computed by `build.mjs` at every build |
| M4 | Error answers echoed internal exception text | Errors now say only "Live data didn't answer just now"; details go to the worker log. The Ask error `detail` field is also removed from replies |
| M5 | Web and Expo install ids were 8 characters of `Math.random` plus a timestamp | 24 random characters from the secure generator; existing ids keep working |
| M6 | A `?me=` link switched a browser to another profile silently | The web app asks first when the browser already has a profile, and removes `?me=` from the address bar |

### Low

Fixed:

* L1. `/api/obs?limit=-1` returned every row. The limit is now 1 to 1000.
* L2. A non text profile in a `POST /api/saved` body crashed the handler. It is now coerced to text.
* L3. Contact messages are now deleted after 12 months, as the privacy policy says. The 90 day search and 30 day watch purges were already running.
* L4 (server side). Bidur's data under the public profile id "bidur" was copied to a new private random id with the admin endpoint `POST /api/admin/profile-copy`. The new id is not in this repo. On 24 Oct 2026 the server stopped accepting it: a profile id must be 6 to 40 safe characters, there is no default profile, and a request with no profile logs nothing and reads no saved trips. The web app moves any browser still on it to a fresh random id and uploads its saved trips again.
* L9. The cron-job.org job sends `TICK_KEY` in an `x-admin-key` header instead of the URL.
* L12. TfNSW alert links become links only when they are plain `https://` URLs, checked on the server (`httpsUrl`) and again in the web Ask screen.
* `/api/ask` replies were 180 to 490 KB because they carried the full planner output. They now carry only the fields the web, Android and iPhone Ask screens read: 5 to 21 KB, about 1 to 2.5 KB gzipped on the wire.

Open:

* L4 (clients). Done on the web (24 Oct 2026). Android and iPhone move off it in their own updates.
* L5. CORS is open (`*`). Acceptable: there are no cookies or logins.
* L6. `/api/stations` answers do not carry the API security headers. Harmless JSON.
* L7. Expo `npm audit`: 7 high, all in build tooling, none in the app runtime. Dependabot alerts and security update pull requests are on.
* L8. Android `allowBackup` is false since versionCode 5 (closed; checked 5 Nov 2026).
* L10. GitHub Actions are pinned to version tags, not commit SHAs. Only push and manual triggers exist, so forks and pull requests cannot run them or reach secrets.
* L11. Secret scanning and push protection could not be switched on through the API. Repo Settings, Code security, Secret Protection.

### Checked and fine

* XSS: the web app escapes every API and user string before it reaches `innerHTML`; no inline event handlers, no `eval`. The Expo app renders with React Native Text.
* SQL: every query uses bound parameters.
* Watch ids are 64 bit random.
* Mobile: no iOS App Transport Security exceptions; Android asks for location, notifications and vibrate only. No secrets in the APK.
* The backend has no npm dependencies, and the iPhone app has no Swift packages.

### Tests

`backend/test/security.test.mjs` (10), `backend/test/ask-size.test.mjs` (3) and `backend/test/profile-copy.test.mjs` (3) cover these fixes.
