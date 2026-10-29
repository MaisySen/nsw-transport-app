# Decisions

Every standing decision, newest first within each group, with the date, who made it and why. Owner decisions are Bidur's; "rule" means a working rule the team set to protect his decisions. Sydney time. Before changing anything listed here, ask the owner. Sources: the owner's messages, CHANGELOG.md, RELEASES.md and the docs named in each row.

Updated 26 Oct 2026, 4:30 PM.

## Money and scale

| Date | Decision | Why | Where it lives |
| --- | --- | --- | --- |
| 26 Oct, 3:47 PM (owner) | Cloudflare stays at US$5 a month (Workers Paid base) with no overage. Built for up to 1,000 people. The million user design stays on paper. | "Can't pay 90. We stay at 5 right now." He expects at most about 1,000 users for now. The 1M estimate was about US$90 a month at 10,000 people. | [COSTS.md](COSTS.md), budget guard, `LOAD_TESTS` off, 4 shards |
| 26 Oct, 3:10 PM (owner) | Plan the data path as if for many users on many devices at once: Transport for NSW calls must never grow with users. | Real use is many phones, watches and widgets at the same moment. | [SCALE_1M.md](SCALE_1M.md): read each feed once, share answers at the edge, our own trip planner |
| 26 Oct, 3:37 PM (owner) | No private usage dashboard for now. "Other works later. Now is not the time." | Focus on speed and reliability. | Do not build or offer extras unasked |
| 26 Oct, 9:12 AM (owner) | Bought Workers Paid (US$5 a month). | CPU per request was over the free plan's 10 ms (p50 53 ms measured 25 Oct, 1:44 AM). Needed before moving phones to api.transportsydney.app. | Cloudflare account, [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md) |
| 24 Oct (owner) | The app is free. No ads, no login, no account, no tracking, no analytics. | It is a public service app; trust and privacy. | README, store listing, [STORE_PRIVACY.md](STORE_PRIVACY.md) |
| Rule | Never buy, upgrade a plan or add a paid product, and never register store records or pay fees, without the owner. | Money and identity are his. | |

## Data and Transport for NSW

| Date | Decision | Why | Where it lives |
| --- | --- | --- | --- |
| 26 Oct, 2:46 PM (owner) | Asked NSW (OpenDataHelp, username bidurtab) for 1,000,000 calls a day and 25 a second. **Pending**, no reply yet. | The Bronze key (60,000 a day) ran out at 1:25 PM. NSW raised another developer's quota in Aug 2025 at no fee. | [STATE.md](STATE.md); raise the server budget when NSW answers ([RUNBOOK.md](RUNBOOK.md) section 5) |
| 26 Oct, about 2 PM (owner approved) | When NSW refuses, show timetable trips and boards, clearly labelled "Timetable times", never "No more services". Only during an outage. | His 2:52 PM screenshots: "No more services today" at 2:52 PM, a raw 502, Ask blaming his signal. Wrong information is worse than none. | `/api/trip` and board fallbacks, `outage16` tests |
| 26 Oct, 3:08 PM (rule after the lag diagnosis) | No load, soak or match tests on production or with the production NSW key. Tests that touch NSW only 11 PM to 5 AM, capped well below the quota. Load tests use a fake NSW on `wrangler dev`. | Our own tests made NSW refuse 8.5% of calls on 26 Oct morning and used the day's quota; the 1,000 phone soak used 70,000 Durable Object requests in an hour. | `LOAD_TESTS=off`, [DIAGNOSIS_LAG.md](DIAGNOSIS_LAG.md), [COSTS.md](COSTS.md) |
| 26 Oct (rule, board engine brief) | The board engine serves phones only after it matches the Trip Planner on 95% or more of a NSW wide sample, and the owner agrees. | It was at 91 to 93%. A board that is wrong 7% of the time is worse than a slower right one. | `ENGINE_BOARDS=off`, [ENGINE.md](ENGINE.md) |
| 26 Oct (rule) | Our own trip planner answers phones only after `tools/planner_match.mjs` passes 90% against the Trip Planner (run 3 to 6 AM). | Not yet compared with NSW. | `OWN_PLANNER=off`, [SCALE_1M.md](SCALE_1M.md) |
| 26 Oct, 12:48 PM (rule) | Live boards are shared at the edge for at most 15 s. Phones do not poll every 30 s. No D1 read replication. | Fresh enough for a platform decision, cheap, and NSW calls stay flat. | [SCALING.md](SCALING.md), [PERFORMANCE.md](PERFORMANCE.md) |
| 25 Oct, 10:16 PM (owner) | Features work for all of NSW, not one suburb ("cant do it with only this suburb"). Tests use NSW wide cases, at most 5% on the owner's own routes. | The app is for everyone. | Test style in [WORKER_GUIDE.md](WORKER_GUIDE.md) |
| Rule | Honest live labels everywhere: Live (with its age), Timetable, Not tracking. Never show a timetable time as live. | Ghost buses were the top complaint in store reviews of other apps (25 Oct research). | [LIVE-LABELS.md](LIVE-LABELS.md) |

## App and releases

| Date | Decision | Why | Where it lives |
| --- | --- | --- | --- |
| 27 Oct 2026, 1:30 AM (owner approved 26 Oct, 5:34 PM) | Git history rewritten once to take a personal phone number out of every old commit, branch and tag (the one owner approved exception to never force push). Every clone made before 27 Oct 2026 must be deleted and cloned fresh. Never merge, rebase or push from an old clone: it would bring the old history back. | The repo is public and old commits still held the number. Commit ids from 25 Oct onward changed. | [RUNBOOK.md](RUNBOOK.md) section 0 |
| 26 Oct, 3:08 PM (rule after the lag diagnosis) | At most one over the air update a day, published overnight (after 10 PM), preview first. | 52 updates in 2 days, each a 6 MB download and a slower start. | [RUNBOOK.md](RUNBOOK.md) section 3 |
| 26 Oct, 5:36 PM (owner) | Platform view removed from the app, not just hidden. | He does not use it and did not want it costing requests. | Deleted in main `e33c2fe` (g23); old `/platform` links get the not found screen (`app/src/app/+not-found.tsx`). |
| 26 Oct, 7:57 AM (owner) | Platform view hidden until it is reliable and the owner agrees. | His iPhone showed glitches on the board ("Board have full glitches", 11:59 PM). | `PLATFORM_VIEW=false` in `app/src/lib/features.ts` |
| 25 Oct (rule) | Version 1.0.0 and runtime 1.0.0 never change. | Runtime policy `appVersion`: a new version would cut every installed build off from over the air updates. | `app/app.json`, [RELEASES.md](RELEASES.md) |
| 25 Oct (rule) | JavaScript ships over the air; native changes wait for the next build. No new native module in an update; every native call is feature detected. Next build: 209 on 1 Nov (the Expo plan's 15 iPhone builds for October are used). | Builds 201 to 208 must keep working on every update. | [IOS27.md](IOS27.md) "Build 209" |
| 25 Oct, 12:38 AM (owner) | The iPhone app is the Expo app (so it gets over the air updates), from build 201; the SwiftUI app is retired. | He asked why updates were slow on iPhone. | `app/`, `ios-native/` kept for reference |
| 25 Oct, 10:49 AM (owner: "Do everything") and rule | Never submit for App Store review, change price or availability, or publish on Google Play without the owner's written OK. TestFlight builds are fine. | Store release is his call. | [RUNBOOK.md](RUNBOOK.md) section 9 |
| 25 Oct, 8:42 PM (owner) | Apple HIG on iPhone, Material 3 on Android: native menus, system controls, no custom imitations. | The custom centred action sheet "looked vibe coded and bad". | [IOS27.md](IOS27.md) "Native menus" |
| 25 Oct (rule, audit) | Battery first: no `setInterval`, no `useNow(1000)`, no high accuracy location, no new `UIBackgroundModes`, polling through `src/lib/activity.ts` only, Pressables carry `accessibilityRole`. | Commuters keep the app open; a hot phone loses trust. | `app/test/battery.test.mjs`, [PERFORMANCE.md](PERFORMANCE.md) |
| 25 Oct, 4:04 PM (owner) | Home is Option A (next trip card on top). | His 3:09 PM "Home page looks clustered". | [HOME-REDESIGN.md](HOME-REDESIGN.md) |
| 24 Oct, 1:58 PM (owner) | Ask is rule based: no AI model, no paid service. | Free, predictable, private. | `app/src/lib/askBrain.ts` |
| Rule | No Transport for NSW logos or branding; our own design with system fonts. "Not made or endorsed by Transport for NSW." Data credited under CC BY 4.0. | Licence terms and store rules. | README, About screen |
| Rule | Never name another transport app in the UI, code or commits. | Store rules and our own identity. | [WORKER_GUIDE.md](WORKER_GUIDE.md) |
| 24 Oct, 9:00 AM (owner) | The repo is public. | Free GitHub Actions minutes; it passed a secret scan first. | No secret values ever in it ([SECURITY.md](SECURITY.md)) |

## Server and data

| Date | Decision | Why | Where it lives |
| --- | --- | --- | --- |
| 26 Oct, 9:58 AM (owner, via the server move) | Phones read api.transportsydney.app; the first address stays only as a read fallback for old builds and is never redeployed. | The new server is on the Fintex account with Workers Paid. | `app/src/lib/server.ts`, [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md) |
| 30 Oct, 8:10 AM (owner) | Disable every tab.bot address. The first address became a forwarder (its /api paths to api.transportsydney.app, its pages to transportsydney.app); the app drops the read fallback to it and the old server morning check move, and build 209 ships api.transportsydney.app as the native built in address. | Nothing public should carry the tab.bot name. | `app/src/lib/server.ts`, `app/src/lib/serverMove.ts`, `app/targets/widget/APIBase.swift` |
| 25 Oct, 12:15 AM (owner) | Domain transportsydney.app (site), api.transportsydney.app (API), publisher Fintex Australia Pty Ltd. | His choice of name; one company for both stores. | DNS on the Fintex Cloudflare account |
| Rule | No D1 migrations without asking. Never deploy an older tree over a newer deploy. Keep the `/api/live-activity` routes. | A migration cannot be rolled back with the code; trip cards on builds 205+ need those routes. | [RUNBOOK.md](RUNBOOK.md) section 1 |
| Rule | Public contact addresses are support@, privacy@ and hello@transportsydney.app. The Fintex mailbox address never appears on the site. | Brand and spam. | `site/`, tests |

## Writing and working

| Date | Decision | Why | Where it lives |
| --- | --- | --- | --- |
| 23 Oct (owner) | No em or en dashes anywhere (UI, code, commits, docs). Plain words, no filler. | His standing writing rule. | `grep -P '\x{2013}\|\x{2014}'` before every commit |
| 23 Oct, 24 Oct 2:01 PM (owner) | Every credential created or changed: email him the full list. Docs kept up to date with every change. | He must own every account and be able to hand over. | [RUNBOOK.md](RUNBOOK.md) section 11 |
| 26 Oct, 4:02 PM (owner) | Runbooks strong enough that a new assistant starts work without asking him anything. | Repeated questions are double handling. | This file, [START_HERE.md](START_HERE.md), [STATE.md](STATE.md) |
| Rule | No hard coded content, example times or the owner's own stops in code. | It must work for everyone, every day. | Code review, tests |
