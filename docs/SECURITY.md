# Security

Where every secret lives, by name only, and the rules that keep them out of the code. No secret value appears in this repository. Updated 24 Oct 2026.

## Rules

1. No secret in git, commit messages, issues, screenshots or logs. The repo is public.
2. The backend source holds placeholders (`__TFNSW_API_KEY__` and so on). `backend/build.mjs` fills them in at build time from `backend/.env`, which is ignored by git.
3. Values only ever go into the server side `worker.mjs`. The web app, the Android app and the iPhone app hold no secrets. `backend/test/site.test.mjs` checks that no API key is in the public files or the source.
4. Owner credentials are sent to Bidur by email from bidur@mail.tab.bot, organised by service, and resent in full whenever one changes.
5. Rotate a secret the moment it may have leaked. Steps per secret: [Runbook, section 7](RUNBOOK.md#7-rotate-keys).

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
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` | App Store Connect API key for signing and TestFlight upload | Not created yet. Will be GitHub Actions repository secrets, never files in the repo |
| Play service account key | Command line Play uploads (`store/play-upload.mjs`) | Not created yet. Will stay on the build machine |
| GitHub | Repository access | Bidur's own account `MaisySen`, connected to Tab by authorization. No password or token stored in the project |
| bidur@mail.tab.bot | Project mailbox for sign ups, resets and store invites | Tab's own mailbox; no separate password |

Admin and scheduler keys go in an `x-admin-key` header. The cron-job.org job sends `TICK_KEY` that way since 24 Oct 2026, so the key is no longer part of its URL. The older `?key=` query form still works; treat any URL that contains one as a secret and do not share it or paste it into a chat.

## Data the service keeps

* No accounts, names, emails (except an optional email on the contact form) or advertising IDs.
* Each install has a random profile id. Saved trips, commutes, searches and watches are stored per profile or device.
* Trip searches are deleted after 90 days, finished watches after 30 days.
* The page counter keeps one total per day, page and referring site. No cookies, IP addresses or browser details. Do Not Track and Global Privacy Control are respected.
* Push subscriptions and Expo tokens are stored per device and removed when they fail or the user turns alerts off.

The full policy is at https://nsw-transport-bot.sites.tab.bot/privacy/ and in [store/privacy-policy.md](../store/privacy-policy.md).

## Reporting a problem

Email contact@fintex.au, or use GitHub private vulnerability reporting on this repo (it is switched on).

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
* No keystore, .p8, .p12, .pem, .env or service account file was ever committed. `worker.mjs` and `tab-site.json` are not served (404).
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
* L8. Android `allowBackup` is true. Planned off in versionCode 5.
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
