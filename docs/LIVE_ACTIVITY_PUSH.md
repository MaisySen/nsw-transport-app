# Trip card push (Live Activity and Dynamic Island)

How the server keeps the iPhone trip card fresh while the phone is locked, what changed on 30 Oct (branch liveact-push), what it costs, and the next steps. Root cause table for the 29 Oct "always stale" report: /home/user/tab/files/stale-rootcause-29oct.md (outside the repo).

## How it works (build 205 and later)

1. The app starts the card with `pushType: .token` (`TransportIOSModule.swift`). iOS gives the card a push token, and the app posts it with the trip's legs to `POST /api/live-activity` (`platform/livePush.ts`). It posts again when a leg is ridden, the trip is replanned or it arrives. `POST /api/live-activity/end` deletes it.
2. The server keeps one row per card in D1 `live_activities`. It's created with CREATE TABLE IF NOT EXISTS, so there is no migration.
3. Each Cron Trigger minute, `laPasses` pushes every due card. It works out the card from live times with the app's own code (LIVECARD, generated from `app/platform/tripCard.ts`), signs one provider token (ES256, key 69AK74573Z, team B85KQRQZW7, kept 40 min in `meta`) and sends `apns-push-type: liveactivity` to the topic `<bundle>.push-type.liveactivity`. The card's stale time is 2 minutes after its live times. On arrival the card gets `event: end` and leaves 2 minutes later.
4. The key is the Worker secret `APNS_KEY`. It is never in the repo.

## 30 Oct changes (why the card went stale)

* **Priority 10 while the trip runs:** `laPriority` uses 10 for an end, a change of words, a warning, and any push whose stale time is under 3 minutes away. With honest stale times that covers every update during a trip. Before, a push that only moved the stale time forward went as priority 5. The phone may hold those to save power, so the card passed its stale time and showed "Updated 8:21am" while the server had fresh times. The app sets NSSupportsLiveActivitiesFrequentUpdates, which gives a card a larger budget for frequent priority 10 updates.
* **Twice a minute, beside the tick:** the scheduled handler runs `laPasses` beside `runTick`, not inside it. That's one pass at once and, while any card is active, a second pass 30 s after the cron's minute. A slow tick (watches, commutes, a slow upstream) or a skipped tick (lease held) no longer delays or drops a card push. `LA_HALF=off` (Worker var) goes back to one pass a minute. `/api/tick` (admin) still pushes cards inside the tick as before.
* **Fresher "updated":** the card's updated time counts from the leg you're on and later legs (`laUpdatedFrom`). Legs already ridden no longer count, because their feed may have dropped the trip and made the card stale early.
* **Fewer writes:** the row is written only when the card's look changes, Apple's answer changes, the card ends or Apple drops the token, and otherwise every 5 minutes. When the server last pushed each card is kept in memory (`laSentMem`), and the push count stays whole (`laUnwritten`).
* **Bigger passes:** a pass sends up to 150 cards, 12 at a time.

## Cost

Assumptions for 1 million installed users: 10% start a trip with a card on a weekday, which is 100,000 cards a day, each about 35 minutes. At 2 pushes a minute that's about 70 pushes per card, 7 million pushes a day or about 210 million a month. Average concurrent cards: 100,000 × 35 / 1,440 ≈ 2,400. The peak is about 6 times that.

| Item | Price (Workers Paid, US$5/month base) | At 1M users | Today (a few cards a day) |
|---|---|---|---|
| Apple push | free | US$0 | US$0 |
| Requests | pushes are subrequests of the cron run, not billed requests | US$0 | US$0 |
| CPU | 30M ms included, then US$0.02 per million ms. About 3 ms per push | about 630M ms, so about US$12/month | US$0 |
| D1 rows written | 50M included, then US$1 per million | about 1M a day (one every few minutes per card), 30M/month, so US$0. Before 30 Oct, one write per push: 210M, about US$160/month | US$0 |
| D1 rows read | 25B included | about 2 passes × active rows, about 200M/month, so US$0 | US$0 |
| Feed fetches for live times | shared 15 s feed copies per server copy | no new NSW calls per card | none |

So at 1M users this is about **US$12/month**, over the US$5 budget. It stays inside US$5 up to about 300,000 users. To bring 1M under budget: send the second pass only to cards whose stale time is under 90 s away or whose next stop is close. That halves it, and the cheaper options below are on the scale path anyway.

## Scale steps (not built)

One cron run pushes at most 300 cards a minute (150 per pass, twice). That covers about 150 concurrent cards at 30 s and 300 at 60 s. Beyond that:
1. Fan out by token hash. The cron run sends each shard's due list to a Cloudflare Queue consumer, about 200 cards per message. Consumers run in parallel, each with its own subrequest budget. The D1 schema doesn't change.
2. Or move each card to an alarm in a Durable Object keyed by token (push when its live times change, at most every 15 s). That costs a DO request per alarm, about US$0.15 per million, so about US$30/month at 210M. Only worth it if second-level freshness is wanted.
3. Push only on change, plus a heartbeat before the stale time. Most minutes in a ride change nothing on the card, so the heartbeat sets the floor at about 1 push a minute.

## Widgets (design, needs a native build, not in 209)

iOS 26 lets the server ask for a widget reload by push (WidgetKit push: a `WidgetPushHandler` on the widget configuration hands its push info to the app, and the server sends `apns-push-type: widgets` to `<bundle>.push-type.widgets`). Reloads are still limited by Apple's widget budget. So the plan is to push only when a saved trip's next service changes meaningfully (delay of 2 min or more, cancelled, platform change), at most every 5 minutes per widget. It needs: the Swift handler and token hand off (build 210), `POST /api/widget-push` storing the token with the profile's saved trips, and a pass in the minute tick that compares each saved trip's next service with the last one sent. The Live Activity stays the live surface during a trip.

## Deploy and check (root OK first)

1. Merge liveact-push to main. Backend tests with `TZ=Australia/Sydney`. Deploy transport-api the usual way (no R2, no migrations), then run verify-deploy.
2. During the next trip on an iPhone (205 to 208): `GET /api/admin/live-activity` (x-admin-key) should show `last_status: 200`, a push count going up about 2 a minute, and `last_push` within 5 minutes. Lock the phone for 5 min: the card keeps counting down and doesn't show "Updated". Off at the stop: the card ends.
3. Rollback: the previous transport-api version, or `LA_HALF=off` for one pass a minute.
