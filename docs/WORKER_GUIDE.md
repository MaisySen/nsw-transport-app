# Worker guide

How several workers (assistants or engineers) work on this repo at the same time without breaking each other. Read [START_HERE.md](START_HERE.md) first. Updated 26 Oct 2026, 4:35 PM.

## Your own clone

```bash
cd <your own task folder>
git clone --depth 200 https://github.com/MaisySen/nsw-transport-app.git repo && cd repo
node tools/orient.mjs          # what is live right now
git log --oneline -20          # what the others just did
```

* One clone per worker, in your own folder. Never work in another worker's clone, never kill another worker's processes or servers.
* Disk is tight on the shared build box (a few GB free). Delete `app/node_modules`, web exports and build output when you finish. Use `timeout -k 5 <seconds>` on every long command (tests, exports, wrangler, eas), so a stuck child is killed rather than left holding a terminal.
* No broad searches outside your clone (no `grep -r /`).

## Commits and pushes

* Small commits, one subject each, message in plain words: what changed and why, the brief name if you have one.
* `git pull --rebase origin main` right before every push. Never force push. Never rewrite history. If the rebase conflicts in a doc, keep both texts: merge your lines into theirs, never drop another worker's text.
* If you cannot `git push` from the box (no stored credentials), push through the GitHub REST API with the owner's connected GitHub authorization: create a blob per changed file, a tree on the remote main's tree, a commit whose parent is the remote main, then `PATCH /repos/MaisySen/nsw-transport-app/git/refs/heads/main` with `force: false`. A 422 means main moved: fetch, rebase, try again. Check the new tree equals your local tree before the PATCH. Add a cache buster query to ref reads, and retry a GitHub 5xx with backoff.
* Docs are part of the change: update `CHANGELOG.md` (newest first), [FEATURES.md](FEATURES.md), [TEST_PLAN.md](TEST_PLAN.md), [API.md](API.md) when the server changes, and [STATE.md](STATE.md) when something live changes.

## Who owns what (26 Oct)

| Area | Code | Owner now |
| --- | --- | --- |
| Board engine, shards, engine push, feed timing, the 95% match gate | `backend/src/engine.js`, `/api/live` on shards, `docs/ENGINE.md` | Board engine worker (g14) |
| Live push for Trip Planner boards, data age per row | `backend/src/livehub.js`, `app/src/lib/boardPush*.ts`, `LIVE_DATA_AGE` | Done (g17); follow ups go through the root |
| Own trip planner | `backend/src/raptor.js`, `tools/build_planner.py`, `tools/planner_match.mjs` | Done (g18); the match run after 3 AM is open |
| Trip tracking (leg progress, ETA, connections from live data and location) | `app/src/lib/liveCalc.ts`, `liveEngine.ts`, `app/src/app/go.tsx`, `/api/service` progress | Trip tracking worker (g19); server live, app waits for the nightly update |
| Cost guard and budget | `budgetCheck` in `backend/src/worker.js`, `docs/COSTS.md` | Cost guard worker (g20) |
| Runbooks and handover docs | `docs/START_HERE.md`, `RUNBOOK.md`, `DECISIONS.md`, `STATE.md`, this file, `tools/orient.mjs`, `tools/verify-deploy.mjs` | Docs worker (g21) |

Touching another area: read its latest commits first, keep your change small, say so in your report. Two workers on `backend/src/worker.js` is normal: rebase, reread the function you change, never paste an old copy over it.

## Shipping

* **Server deploy:** [RUNBOOK.md](RUNBOOK.md) section 1. Deploy only from a fresh rebase of main that contains the live deploy's commit, so you never take another worker's code off the server. Write the rollback version in RELEASES.md and CHANGELOG.md.
* **Over the air update:** [RUNBOOK.md](RUNBOOK.md) section 3. One a day, overnight, preview then production. It ships everything on main, so check main's tests first and name the other workers' commits it carries. The update before yours is your rollback target.
* **No EAS build** until build 209 on 1 Nov. Native needs go under "Build 209 (1 Nov)" in [IOS27.md](IOS27.md).
* **No Transport for NSW calls for tests during the day** (only 11 PM to 5 AM, capped). No load tests on production. No D1 migrations without asking.
* Send the root (or the owner's assistant) one line at each real milestone: preview published (with two screenshot paths), production live, deploy done. Do not message the owner directly unless your brief says so.

## Tests

```bash
cd backend && timeout -k 5 600 node --test test/*.test.mjs 2>&1 | grep -E '^not ok|^# (pass|fail)'      # fail 0
cd app && npm ci && timeout -k 5 300 npx tsc --noEmit                                                  # no output
cd app && OFFLINE=1 timeout -k 5 900 node --test test/*.test.mjs 2>&1 | grep -E '^not ok|^# (pass|fail|skipped)'   # fail 0; a few skipped offline
cd app && OFFLINE=1 node --test test/battery.test.mjs                                                  # the battery rules, must pass
```

`test/battery.test.mjs` fails on `setInterval`, `useNow(1000)`, high accuracy location, Pressables without `accessibilityRole` and new background modes. Poll only through `startAppPoll`, `useScreenPoll` and `useNow` from `app/src/lib/activity.ts`.

## Checks on screen

Build the web export and look at it before any update:

```bash
cd app && EXPO_PUBLIC_LOOK=android timeout -k 5 600 npx expo export --platform web --output-dir dist-web
# serve dist-web as a single page app (unknown paths return index.html), then with playwright-core and a Chrome:
node test/e2e/buttons.mjs out.json PORT       # every main button acts on the first tap
```

Screenshots for the root: iPhone sizes 390 x 844 and 430 x 932, light and dark (a Playwright context with that viewport, `deviceScaleFactor: 2`, `isMobile: true`, `colorScheme` light or dark, `locale: "en-AU"`, `timezoneId: "Australia/Sydney"`). Other checks are in [app/test/e2e/README.md](../app/test/e2e/README.md) (accessibility, live replay, missed connection). A screenshot is not a device check: say "not tried on a real phone" until someone has.

## Style

* No em or en dashes anywhere: UI text, code, comments, commits, docs. Check: `git diff | grep -nP '\x{2013}|\x{2014}'`.
* Plain words. No filler, no hype, no "seamless", no "robust". Say what changed and what the user sees.
* No hard coded content: no example times, no owner stops or routes in code. Tests use NSW wide cases (Sydney, regional, buses, ferries, light rail), with at most 5% on the owner's own routes.
* Never name another transport app in the UI, code, comments or commits. Say "other apps" if you must.
* No ads, no login, no AI model in Ask, no Transport for NSW logos. Apple HIG on iPhone, Material 3 on Android, system controls first. Debug hooks only under `__DEV__`.
* No secret values in the repo, logs, screenshots or reports. Name where it lives ([SECURITY.md](SECURITY.md)). Pass tokens to a command through its environment only, from a mode 600 copy you delete after.

## Reports

Your final report says: what shipped (update ids, deploy ids), the rollback for each, files touched, commit ids, what is not verified (especially "not tried on a real phone"), contradictions you found and what you did about them, and anything only the owner can do. Numbers say where they came from.
