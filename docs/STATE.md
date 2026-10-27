# State

What is live and what is open, by hand, with when each line was last checked. Run `node tools/orient.mjs` for the live numbers; it reads the same sources. Update this file whenever something live changes (a deploy, an update, a flag, a build, an owner answer).

**Last verified: Tue 27 Oct 2026, 10:31 AM Sydney (23:31 UTC)**, the server row with `tools/verify-deploy.mjs` (all checks ok) after the 10:30 AM deploy; the over the air row as of 11:37 PM with `tools/orient.mjs` and the production manifests; the other rows as of 8:33 PM with `tools/orient.mjs` and `tools/verify-deploy.mjs` (all checks ok).

## Live now

| What | Value | Rollback |
| --- | --- | --- |
| Production over the air group | `ecb0882d-4809-430e-8e2e-89248ad01fba` (27 Oct, 11:14 AM, emergency update "Crash safety net", root authorised: the shipped 27efc6bd code plus only the crash net, branch `hotfix-crash-27oct` commit `f9fac91`, republished from preview group `64df6e5f-e712-4c8c-a475-5bd2cc68b5e2`; iOS `01a17ab4-dbde-7688-bd68-61a2e374d6a3`, Android `01a17ab4-dbde-7d7b-8bca-7b271b3c1b20`), runtime 1.0.0. Manifests checked on preview and production (launch asset hashes match the local export, both platforms). Not checked on a device. None of 27 Oct's main app work is in it | `27efc6bd-9201-4e4d-b39b-a070b56d7e89` (26 Oct, 11:35 PM overnight update, main `0dfd53c`): `npx eas-cli update:republish --group 27efc6bd-9201-4e4d-b39b-a070b56d7e89 --destination-branch production --message "Roll back" --non-interactive` |
| Updates published today | 27 Oct: emergency crash safety net at 11:14 AM (`ecb0882d`, root authorised). Tonight's one update still due from main (it already carries the same net, 83af52f) | |
| Server (`transport-api`) | Version `2aff7f9b` since 27 Oct, 10:44 AM (rolled back by the root after the owner's crash report; deployment e334e191, checked 11:10 AM; C and D out). Before the rollback: version `f8c60d91` (27 Oct, 10:30 AM, speed pass part 2 steps A to D: x-serves, x-device, /api/trip/live on the engine's live rules, ETags, cold trip 1.5 s with timetable trips, no error copies, service quick answer beside the full one with the train stop list from the engine's timetable while the guard holds the planner object, main `cb32d76`; vars `WORKERS_CACHE` unset (off), `ID_HEADERS`, `TRIP_LIVE`, `TRIP_QUICK_TT` unset (on)). Before it `a6059579` (10:23 AM, C), `2aff7f9b` (10:10 AM, B), `05eb669b` (10:02 AM, A), `5c810ba2` (9:37 AM, part 1) | `npx wrangler@4 rollback a6059579-f4bf-4fed-b287-775cd2655301 --name transport-api` (or `5c810ba2` to drop all of part 2; `TRIP_LIVE=off` or the server switch kill `tripLive` takes trip-live out of x-serves) |
| iPhone builds in the field | 201 to 208 (208: 25 Oct 6:48 PM, TestFlight Internal and Public) | |
| Android | versionCode 2 to 5 (APK on the download page) | |
| Public site | Pages deployment `202d89e9` (27 Oct, 12:56 PM, privacy policy discloses crash reports, main 2200264; checked 12:57 PM: /privacy/ live equals the source). Before it `462d58fc` (26 Oct, privacy g25), `6a797b2c` (25 Oct, 9 PM) | `462d58fc` |
| Cloudflare plan | Workers Paid since 26 Oct 9:06 AM; cycle 25 Oct to 25 Nov; invoice US$5.00 paid; usage charges US$0.00 (dashboard, 4 PM) | |
| NSW calls today | 51,580 of 60,000 at 4:23 PM; refusals since about 1:25 PM. Resets at 1 AM AEDT | |

## Flags (4:18 PM)

| Flag | Where | Value | Meaning |
| --- | --- | --- | --- |
| `ENGINE_BOARDS` | Worker var | off | Boards from the Trip Planner path, not the engine |
| `ENGINE_PUSH`, `ENGINE_FEED_TIMING` | Worker var | not set (off) | Engine push socket, feed timed pulls |
| `ENGINE_SHARDS` | Worker var | 4 | Board shards (was 16 until 4:13 PM) |
| `ENGINE_IDLE_MIN` | Worker var | 5 | Engine objects sleep 5 min after the last read |
| `ENGINE_LEARN` | Worker var | off | No learn calls into the engine while it is off |
| `ENGINE_LEARN_CORE`, `ENGINE_LEARN_MOVED` | Worker var | not set (on, since 27 Oct 8:37 AM) | The engine core reads planner boards for stand names itself (at most 30 a minute, 2,000 a day); moved stands kept 36 h. "off" restores the old rule / keeps no moved stand |
| `LIVE_PUSH` | Worker var | off | No socket push for Trip Planner boards |
| `OWN_PLANNER` | Worker var | off | Trip searches still go to the Trip Planner. With it on, a phone that sends `days=1` also gets trip lists a whole day at a time from our planner (src/daylist.js, 27 Oct); off, those phones get Trip Planner pages as before |
| `LOAD_TESTS` | Worker var | off | Load test keys refused |
| `REQ_LOG` | Worker var | on | One log line per request, 1 in 10 kept |
| `PREWARM` | Worker var | not set (on, since 27 Oct) | The minute tick keeps used trip pairs, boards and car parks fresh in their usual hours (at most 3 fetches a minute, 1,200 NSW calls a day). "off" stops it |
| `SERVICE_QUICK` | Worker var | not set (on, since 27 Oct) | A service detail not ready in 0.8 s is answered from the realtime feed alone (partial) while the full stop list finishes behind it. "off" waits for the full answer |
| Budget guard hold | `/api/budget` | **on** at 4:23 PM: the last hourly reading (made before the 4:21 PM change to a 48 hour rate) projected Durable Object requests at 1,363% of the month (11.3% used), driven by the morning load tests | Engine, push, own planner, learn and load keys act as off; all are off anyway. The next hourly check (minute 17) reads again; it lifts by itself when the projection is back under 60%, or with `POST /api/budget/clear` |
| Remote config flags | `/api/app/config` | all 16 on, `kill` empty, `livePush` absent (off) | |
| `LIMITED_STOPS` | Worker var (g22, deployed 8:24 PM) | not set (on) | `limited: true` on departures and trip legs from the planner pack's `tripLim`; `off` turns it off |
| `OWN_RUNS` | Worker var (g24) | not set (on) | Service stop lists from the planner pack's run (`tripNext`); `off` turns it off; stands down while the budget guard holds `OWN_PLANNER`. Needs a pack with `tripNext` (nightly from main) |
| `tripAlerts` | Remote config (g22, server deployed 8:24 PM) | default true | Server matches alerts to phones' trips every 10 min; the app's More switch shows only when this is true |
| `LIVE_DATA_AGE` | `app/src/lib/features.ts` | false | Live age counted from receipt, not from `liveAt` |

## Open bugs

| Since | Bug | Status |
| --- | --- | --- |
| 27 Oct, 10:43 AM (owner) | App crashing continuously. Server log of his profile: normal use 10:14 to 10:17 (server 2aff7f9b), then a crash loop 10:42:39 to 10:43:20, about 7 s per launch, each fetching the Home commute trips and three boards. No TestFlight crash reports, no OTA since 27efc6bd | Server rolled back to 2aff7f9b at 10:44 AM (C and D out). Cause not yet found: the shipped code on Home with his real answers draws without error on the web build, so iOS only code or a kept copy on his phone is likely. Crash safety net with reporting on main and on branch hotfix-crash-27oct for an emergency update (root decides). Emergency update published 11:14 AM: production group `ecb0882d-4809-430e-8e2e-89248ad01fba` from `hotfix-crash-27oct` f9fac91; roll back to `27efc6bd` |
| 27 Oct, 8:35 AM (owner) | Home commute card "Live trips unavailable right now" and header "No live times" (Strathfield to Kings Cross), and Home felt slow | Cause found: the phone gives up on a trip at 10 s, the server waited up to 12 s plus a retry for a slow Trip Planner on a cold pair (no copy), and the planner call was dropped with the phone's request. Server fix (TRIP_QUICK, timetable stand in at 6.5 s, planner answer kept for the next poll) live in `99887568` (8:51 AM), roll back `f0da740a`. No app update needed. App side (kept trips marked Updating, quick asks again, no "No live times" while first requests are out, commute first, TRIP_MS 13 s) on main 27 Oct, ships with tonight's over the air update |
| 26 Oct, 3:43 PM (owner) | Trip tracking followed the timetable, not the delayed train: on the 8:46 Strathfield T1 the app said he was at Town Hall and should change while he was not yet at Redfern; ETA 9:15 never moved; the change was treated as made | Cause found (Town Hall had no live time, the leg ended on the clock). Server fix live (`544279b4`). App fix (`225e7b9`) shipped in the 11:35 PM update (`27efc6bd`). Not tried on a real phone |
| 26 Oct | During the NSW outage: trips ending at a service's last stop (for example F1 Circular Quay to Manly) get no timetable fallback; no walking between stops in the fallback | Known gap, not scheduled |
| 26 Oct | Outage fixes (`fa0017d8`), live push code and the 11:35 PM update (`27efc6bd`: get off alert timing on a locked phone, live busy hour, real notifications) are not yet tried on a real phone | Device check after 1 AM ([TEST_PLAN.md](TEST_PLAN.md), "Outage mode checks") |
| 25 Oct | Builds 207 and 208 not yet seen on a real iPhone or Apple Watch | Device checklists in TEST_PLAN.md |
| 26 Oct | The owner's personal mobile number was in three public docs (App Review contact); removed from the current tree today, still in git history | History rewrite needs a force push, which is not allowed; owner to decide |

## Waiting on the owner

| Item | Since | Notes |
| --- | --- | --- |
| NSW quota increase reply (1,000,000 a day, 25 a second) | 26 Oct, 2:46 PM | When it comes: raise the server budget (RUNBOOK section 5) |
| OK to submit iPhone 1.0.0 for App Store review | 25 Oct | Also needed first: Apple Watch screenshots (none uploaded, required), the newest build on the version (206 attached), and a decision on reshooting the iPhone screenshots that show his own stations. Listing, review notes, App Privacy and age rating checked 26 Oct (store/README.md) |
| Apple account conversion to Fintex (organisation, D-U-N-S 889795329) | 25 Oct | Seller shows his own name until then |
| Google Play: create the app, invite the service account, first AAB upload, 12 testers for 14 days if personal | 24 Oct | RUNBOOK section 9 |
| Firebase project and FCM key for Android alerts with the app closed | 24 Oct | `app/NEEDS_BIDUR.md` |
| Cloudflare dashboard: turn off Web Analytics and Email Address Obfuscation for transportsydney.app | 25 Oct | Only affects the 404 page (RUNBOOK section 12) |

## Scheduled next

| When (Sydney) | What | Who |
| --- | --- | --- |
| 27 Oct, after 10 PM | The one over the air update of the day from main, if green. Production is now the emergency group `ecb0882d` (11:14 AM, crash net only); that is tonight's rollback target | The root decides; preview first |
| 27 Oct, 1 AM | NSW quota resets: probe once, `node tools/verify-deploy.mjs --live`, device check of the outage fixes | Any worker |
| 27 Oct, after 1 AM | Board engine 95% match run on real feeds (capped); engine stays off for phones until the owner agrees | Board engine worker |
| 27 Oct, 2:40 AM | Timetable workflow: planner pack (nightly, first pack with `tripNext` for g24 stop lists; check `/api/raptor/status` counts and a T9 `/api/service` from Gordon after 1 AM), engine load only if it no longer holds today and tomorrow | GitHub Actions |
| 27 Oct, 3 to 6 AM | `tools/planner_match.mjs` (our planner vs NSW, gate 90%) | Any worker, off peak |
| Next server deploy | **Pending deploy** (on main, not deployed, 27 Oct): `/api/trip` legs marked `realtime` only when the estimate differs from the timetable or the trip leaves within 60 min (tripLegsOf, test/trip-realtime.test.mjs). Goes out with the next deploy from main; no flag | Whoever deploys the server next |
| From 1 Nov | iPhone build 209 with the native list in IOS27.md (Watch gets times from the phone, widget push, calendar, audio route) | Build worker, after the owner's go |
| 25 Nov | Cloudflare cycle renews (US$5) | |

## Recent credentials changes

* 26 Oct, about 4 PM: new read only Cloudflare analytics token (Account Analytics Read), also set as the Worker secret `CF_ANALYTICS_TOKEN`. The full credentials list was emailed to the owner's ops email at 4:05 PM.
* 25 Oct, 7:06 PM: Expo token rotated to a robot token ([RUNBOOK.md](RUNBOOK.md), Expo token rotation).
