# State

What is live and what is open, by hand, with when each line was last checked. Run `node tools/orient.mjs` for the live numbers; it reads the same sources. Update this file whenever something live changes (a deploy, an update, a flag, a build, an owner answer).

**Last verified: Mon 26 Oct 2026, 8:33 PM Sydney (09:33 UTC)**, with `tools/orient.mjs` and `tools/verify-deploy.mjs` (all checks ok).

## Live now

| What | Value | Rollback |
| --- | --- | --- |
| Production over the air group | `fa0017d8-4ffe-49e7-91da-3b415254943f` (3:39 PM, outage honesty; iOS `01a17680-b011-7faf-8316-b658423cff0e`, Android `01a17680-b011-7caf-9da9-c4d39cd16f3b`), runtime 1.0.0, from main `4835561` | `1f117d04-ee6c-4149-b153-b32fe8f1db79` |
| Updates published today | 1 production update since 3:39 PM is today's; the next is tonight's overnight update | |
| Server (`transport-api`) | Version `d76e91a8` (8:32 PM, the g28 server fixes: shared answers on own timers, feed fetch kept alive, non JSON NSW answer as down, own keys and predict 400, g30, main `aa375e5`; roll back to `16b2b9f5`: `npx wrangler@4 rollback 16b2b9f5-5582-41d7-8d00-1ff7f3b67f08 --name transport-api`). Before it: `16b2b9f5` (8:24 PM, stop lists from the timetable run and outage trips to a last stop, g24, with the g22 server part, main `c40d52b`; roll back to `3e88773d`). Before it: `3e88773d` (5:45 PM, privacy: invocation logs off, trip history stops only, g25, main `64ed406`). Before it: `ffc1a25b` (4:21 PM, budget guard with a 48 hour rate, main `e93ff84`), `a8fbe352` (4:14 PM, no message, a secret or settings change), `3f5e63d3` (4:13 PM, budget mode, main `ae182e8`), `544279b4` (4:10 PM, live trip follows the real train, main `dd2641a`) | One step: `16b2b9f5` (`npx wrangler@4 rollback 16b2b9f5-5582-41d7-8d00-1ff7f3b67f08 --name transport-api`). Then `3e88773d`, `ffc1a25b`, `a8fbe352`. Before budget mode: `544279b4`. Before trip tracking: `fb242627` |
| iPhone builds in the field | 201 to 208 (208: 25 Oct 6:48 PM, TestFlight Internal and Public) | |
| Android | versionCode 2 to 5 (APK on the download page) | |
| Public site | Pages deployment `6a797b2c` (25 Oct, 9 PM) | `564bc47c` |
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
| `LIVE_PUSH` | Worker var | off | No socket push for Trip Planner boards |
| `OWN_PLANNER` | Worker var | off | Trip searches still go to the Trip Planner |
| `LOAD_TESTS` | Worker var | off | Load test keys refused |
| `REQ_LOG` | Worker var | on | One log line per request, 1 in 10 kept |
| Budget guard hold | `/api/budget` | **on** at 4:23 PM: the last hourly reading (made before the 4:21 PM change to a 48 hour rate) projected Durable Object requests at 1,363% of the month (11.3% used), driven by the morning load tests | Engine, push, own planner, learn and load keys act as off; all are off anyway. The next hourly check (minute 17) reads again; it lifts by itself when the projection is back under 60%, or with `POST /api/budget/clear` |
| Remote config flags | `/api/app/config` | all 16 on, `kill` empty, `livePush` absent (off) | |
| `LIMITED_STOPS` | Worker var (g22, deployed 8:24 PM) | not set (on) | `limited: true` on departures and trip legs from the planner pack's `tripLim`; `off` turns it off |
| `OWN_RUNS` | Worker var (g24) | not set (on) | Service stop lists from the planner pack's run (`tripNext`); `off` turns it off; stands down while the budget guard holds `OWN_PLANNER`. Needs a pack with `tripNext` (nightly from main) |
| `tripAlerts` | Remote config (g22, server deployed 8:24 PM) | default true | Server matches alerts to phones' trips every 10 min; the app's More switch shows only when this is true |
| `LIVE_DATA_AGE` | `app/src/lib/features.ts` | false | Live age counted from receipt, not from `liveAt` |

## Open bugs

| Since | Bug | Status |
| --- | --- | --- |
| 26 Oct, 3:43 PM (owner) | Trip tracking followed the timetable, not the delayed train: on the 8:46 Strathfield T1 the app said he was at Town Hall and should change while he was not yet at Redfern; ETA 9:15 never moved; the change was treated as made | Cause found (Town Hall had no live time, the leg ended on the clock). Server fix live (`544279b4`). App fix on main (`225e7b9`), ships in tonight's update. Not tried on a real phone |
| 26 Oct | During the NSW outage: trips ending at a service's last stop (for example F1 Circular Quay to Manly) get no timetable fallback; no walking between stops in the fallback | Known gap, not scheduled |
| 26 Oct | Outage fixes (`fa0017d8`) and live push code are not yet tried on a real phone | Device check after 1 AM ([TEST_PLAN.md](TEST_PLAN.md), "Outage mode checks") |
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
| Tonight, after 10 PM | The one over the air update of the day: trip tracking app fix and whatever is on main and green | The root decides; preview first |
| 27 Oct, 1 AM | NSW quota resets: probe once, `node tools/verify-deploy.mjs --live`, device check of the outage fixes | Any worker |
| 27 Oct, after 1 AM | Board engine 95% match run on real feeds (capped); engine stays off for phones until the owner agrees | Board engine worker |
| 27 Oct, 2:40 AM | Timetable workflow: planner pack (nightly, first pack with `tripNext` for g24 stop lists; check `/api/raptor/status` counts and a T9 `/api/service` from Gordon after 1 AM), engine load only if it no longer holds today and tomorrow | GitHub Actions |
| 27 Oct, 3 to 6 AM | `tools/planner_match.mjs` (our planner vs NSW, gate 90%) | Any worker, off peak |
| From 1 Nov | iPhone build 209 with the native list in IOS27.md (Watch gets times from the phone, widget push, calendar, audio route) | Build worker, after the owner's go |
| 25 Nov | Cloudflare cycle renews (US$5) | |

## Recent credentials changes

* 26 Oct, about 4 PM: new read only Cloudflare analytics token (Account Analytics Read), also set as the Worker secret `CF_ANALYTICS_TOKEN`. The full credentials list was emailed to the owner's ops email at 4:05 PM.
* 25 Oct, 7:06 PM: Expo token rotated to a robot token ([RUNBOOK.md](RUNBOOK.md), Expo token rotation).
