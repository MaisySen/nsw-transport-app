# Requirements

What Transport does, by version, and where each feature stands on each platform. Updated 24 Oct 2026, 2:20 PM Sydney time.

Status words: **Done** (live for users), **In progress** (being built now), **Planned** (agreed, not started), **Blocked** (waiting on something outside the code).

Platforms: **Web** is the web app at https://nsw-transport-bot.sites.tab.bot. **Android** is the Expo app (APK and over the air updates). **iPhone** is the native SwiftUI app. Expo Go on iPhone gets the same updates as Android.

## Goals

1. Bring back the old Transport for NSW "Transport Bot": type a stop number or a place and get the next services.
2. Match or beat TripView and the Opal Travel app for live accuracy and trip planning.
3. Feel native on each platform (Apple Human Interface Guidelines on iPhone and web, Material on Android).
4. Cost nothing per user: no AI models, free Transport for NSW data, one small backend.
5. Be ready for the App Store and Google Play.

## Non functional requirements

| Requirement | How it is met | Status |
| --- | --- | --- |
| Live data refresh | Boards and trips refresh every 15 to 20 seconds while open; countdowns tick every second | Done |
| Honest times | Every row says Live or Scheduled; predictions are labelled with how many trips they come from | Done |
| No account or login | Each install gets its own random profile id | Done |
| Privacy | No cookies, no tracking, first party page counter only; searches deleted after 90 days, finished watches after 30 | Done |
| Upstream budget | Transport for NSW Bronze plan: 60,000 calls a day. The backend counts calls and stops background sampling at 40,000 and watches at 56,000 | Done |
| Works offline at launch | App opens with no network and shows each tab (tested on iPhone) | Done |
| Accessibility | Labels on controls, Dynamic Type, dark mode. Lighthouse accessibility 96 to 100 on web | Done |
| Writing style | No em dashes or en dashes and no filler words in any text | Done, checked by tests |
| Cost of the Ask chat | Rule based, no AI model, no per message cost | Done |

## v1: Transport Bot (23 Oct 2026)

| Feature | Web | Android | iPhone |
| --- | --- | --- | --- |
| Type a stop number (for example 213516) for the next services | Done | Done | Done |
| Type a station name for a live board with mode tabs | Done | Done | Done |
| "next train from Strathfield" filters by mode | Done | Done | Done |
| "Burwood to Central" plans trips, "at 8am" or "by 9am" | Done | Done | Done |
| "alerts T1", "alerts buses" | Done | Done | Done |
| Stops near me | Done | Done | Done |
| Plain text answers for messaging (`format=text`) | Done | n/a | n/a |

## v2: live everywhere (24 Oct 2026, midnight)

| Feature | Web | Android | iPhone |
| --- | --- | --- | --- |
| Auto refresh and ticking countdowns | Done | Done | Done |
| Live and Scheduled badges; timetable time struck through when different | Done | Done | Done |
| GTFS realtime fills in live times the trip planner lacks | Done (backend) | Done | Done |
| Live vehicle map with stop list, next stop and crowding | Done | Done | Done |
| Trips with leave in countdown, change times, tight changes flagged | Done | Done | Done |
| Save a trip by name ("save Burwood to Central as home", then "home") | Done | Done | Done |
| Alerts and platform changes attached to services | Done | Done | Done |

## v3: it comes to you (24 Oct 2026, 12:41 AM)

| Feature | Web | Android | iPhone |
| --- | --- | --- | --- |
| Watch any trip: leave now, late, platform change, cancelled, arriving alerts | Done (Web Push) | Done (while open or in background) | Done |
| Connection rescue: replans when a late leg breaks a change | Done | Done | Done |
| Commute memory: offers to save a repeated trip, heads up before it | Done | Done | Done |
| Delay predictions from recorded history ("usually 4 min late") | Done | Done | Done |
| Installable web app (PWA) with offline shell | Done | n/a | n/a |
| Minute scheduler via cron-job.org calling `/api/tick` | Done (backend) | | |

## Phase 4: native apps (24 Oct 2026)

| Feature | Web | Android | iPhone |
| --- | --- | --- | --- |
| Native app with tab bar, large titles, haptics, swipe actions, dark mode | n/a | Done | Done |
| Download page and APK served from the backend | Done | Done | n/a |
| Over the air JavaScript updates (EAS Update) | n/a | Done | Expo Go only |
| Native push (Expo push) | n/a | Blocked: closed app push needs a Firebase project | Expo Go: Done. Native app: push needs a signed build |
| Home screen widgets (pick a trip or stop, countdown) | n/a | Done (Next trip widget, small and medium) | Done (small, medium, large, StandBy, Lock Screen, stop board) |
| Live Activity and Dynamic Island for a watched trip | n/a | n/a | Done |
| Siri: "Next train home", "Ask Transport" | n/a | Planned (Google Assistant) | Done |
| Trips home: Add home and Add work, Home to Work before noon, alerts banner, countdown colour by time left, crowding, skip departed | Done | Done | Done |
| Ask tab: chat with live answers and cards that open the board, trip or map | Done | Done | Done |
| Per install profile (no shared saved trips) | Done | Done | Done |
| Store readiness: privacy manifests, attribution, support and privacy links, final IDs | n/a | Done | Done |
| New trip by mode: Train, Metro, Bus, Ferry, Light rail, Search any stop; A to Z with side index, By distance, By map; bus route, direction, stops | Done | Done | Done (build 8) |
| Confirm trip sheet: rename, extend, connection time | Done | Done | Done (build 8) |
| Direct services by default with an All services switch per trip | Done | Done | Done (build 8) |
| Drag to reorder trips | Done | Done | Done (build 8) |
| Website launch checklist (20 points: landing page, 404, meta, sitemap, robots, terms, contact form, analytics without cookies) | Done | n/a | n/a |
| Ask resolves places properly: stations and 5,087 suburbs before businesses, typo fixes, "Did you mean" | Done (backend) | Done | Done |
| Ask supports "via" | Done (backend) | Done | Done |
| Multi leg trips: 1 to 6 legs, any mode including walk, change time per stop, tight and missed connection warnings | Done | Done | Planned |
| Ask with several stops ("via Central and Chatswood", "A then B then C"), opens or saves as a multi leg trip | Done | Done | Planned |
| Android widget for multi leg trips, long press shortcuts, large stop board widget | n/a | Planned (new APK) | n/a |
| App Store and Google Play submission | n/a | Blocked on Bidur (see [Store](STORE.md)) | Blocked on Bidur |
| Move the whole project to Bidur's Windows PC | Planned, last | | |

## Phase 5: live trip tracking (24 Oct 2026, web)

| Feature | Status |
| --- | --- |
| Start trip from any trip result or saved trip (Start trip on the expanded service row) | Done, web |
| Live trip screen: map with every leg's route, the live vehicle, your own position (optional), stops left, next stop, live arrival at your stop and at the destination | Done, web |
| Current step card: board, leaves in, stops away; on board, next stop, stops to your stop, change or arrive time | Done, web |
| Tight and missed connection warnings from live times, with a link to the next connection | Done, web |
| Get off alerts: one stop before your stop and at each change (from the vehicle's real position), connection at risk; on the phone while open, and through the server watch when notifications are on | Done, web |
| Share live trip: a link anyone can open (/live/?t=...), no account, optional location, deleted when the trip ends | Done, web |
| Multi leg trips (from /api/plan and saved multi leg trips) | Done, web |
| Privacy: location stays on the phone unless sharing with Include my location on; shared rows deleted at the end | Done, privacy page updated |
| Android ongoing notification, iPhone Live Activity and Dynamic Island | Not started, see port notes |

## Phase 6: your history, your control (24 Oct 2026, web)

| Feature | Web | Android | iPhone |
| --- | --- | --- | --- |
| No hard coded stations: the Popular stations list is gone; an empty Trips screen shows Add a trip and Nearby (when location is allowed) | Done | Planned (next update) | Planned (build 9) |
| Saved trips are only the ones you make, nothing is seeded; Edit at the top of Trips, swipe left or tap and hold for Edit trip and Delete trip | Done | Planned | Has swipe delete and Edit; check |
| Recent trips and Recent stops shown below saved trips, labelled Recent, each with Clear and per item Remove (swipe left or tap and hold), Clear has Undo | Done | Planned | Planned |
| Settings, Clear history: clear recent searches, recent stops, recent trips | Done | Planned | Planned |
| Delete my trip history on server (`POST /api/history/delete`, scope history), with a confirm sheet | Done | Planned | Planned |
| Delete all my data (scope all: saved trips, commutes, watches, alerts, push sign up, shares, plus the app's storage), with a confirm sheet | Done | Planned | Planned |

