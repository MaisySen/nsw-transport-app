# Calendar leave by

More > Calendar leave by, off by default. When it is on, Home shows a line for each event in the next 6 hours that has a place, with the live trip from where your usual trip starts:

> Leave by 7:44pm for Team meeting (Barangaroo)
> T9 from Strathfield, arrive 8:08pm. Starts 8:15pm

Tapping it opens the trip screen to that place at Arrive by the event's start time, with the trip you would take (the last one that still arrives in time) open. Asked for by Bidur at 5:10 PM on 25 Oct ("All yours. Do your wish", the brainstormed ideas).

Code: `app/src/lib/calendarLeaveByCore.ts` (pure, unit tested in `app/test/calendarleaveby.test.mjs`), `app/src/lib/calendarLeaveBy.ts` (the calendar module, feature detected), `app/src/components/CalendarLeaveBy.tsx` (the Home card), `tripForCalendar` in `app/src/lib/api.ts`, the switch in `app/src/app/(tabs)/settings/index.tsx`, `calLeaveBy` and `calPlaces` in `app/src/lib/store.ts`, `arriveByIndex` in `app/src/lib/planCore.ts` (the trip screen at Arrive by). Remote flag `calendarLeaveBy` (on unless the server turns it off). Shipped over the air on 25 Oct, 6:40 PM, group f773ab8e (docs/RELEASES.md).

## Which builds show it

| Build | Calendar module | Read access text in the app | Calendar leave by |
| --- | --- | --- | --- |
| iPhone 201 to 205 | No | No | Hidden |
| iPhone 206 and 207 | expo-calendar 58.0.6, `writeOnlyAccess: true` | No: only `NSCalendarsWriteOnlyAccessUsageDescription` (Add to Calendar) | Hidden |
| iPhone 208 and later (branch native-207) | expo-calendar 58.0.6, `writeOnlyAccess: false` | `NSCalendarsFullAccessUsageDescription`, and the add only text kept | Shown in More, off until switched on |
| Android versionCode 5 | No | (no text on Android) | Hidden |
| Android with the calendar module | Yes, with `READ_CALENDAR` and `WRITE_CALENDAR` | | Shown in More, off until switched on |
| Web | No | | Hidden (the dev build can load a labelled mock, below) |

Checked in the code on 25 Oct: `app/package.json` and `app/app.json` on main, native-206 and native-207 all have expo-calendar 58.0.6 with `writeOnlyAccess: true` and `calendarPermission` worded for adding; there is no `ios/` folder (the Info.plist is made from app.json at build time). The expo-calendar 58 config plugin writes `NSCalendarsWriteOnlyAccessUsageDescription` when `writeOnlyAccess` is true and `NSCalendarsFullAccessUsageDescription` only when it is false, so 206 and 207 have no full access text.

Why the gate is the build number and not only the module: reading events on iOS 17 and later needs full access. On 206 and 207 the module is there but the full access text is not. The current expo-calendar request (`requestCalendarPermissions(false)`, native module CalendarNext) checks the Info.plist first and refuses without the text, but the older one (`requestCalendarPermissionsAsync`) goes straight to `requestFullAccessToEvents` without that check in the module, and iOS ends an app that asks for a protected resource without its usage text. So on iPhone the feature needs ExpoCalendar, CalendarNext and `Application.nativeBuildVersion` 208 or more (`readSupported` in the core), and the request always goes through `requestCalendarPermissions(false)`. Nothing new is called on builds 201 to 207, so the JavaScript ships over the air now and lights up by itself on 208.

Full access, not write only: write only access (iOS 17) lets an app add events but not see any. Leave by has to read the time and place of upcoming events, so it asks for full access, once, when the switch is turned on, with this text (build 208, app.json on native-207):

> Transport reads the time and place of your upcoming events to show when to leave for them, if you turn on Calendar leave by. Event names and notes stay on your iPhone.

Add to Calendar keeps its own add only text and still needs no prompt for the system sheet.

The native part for 208 (branch native-207, with its checklist in docs/TEST_PLAN.md there, "Build 208 checklist: Calendar leave by"): `writeOnlyAccess: false` and the text above for `calendarPermission`, `NSCalendarsWriteOnlyAccessUsageDescription` moved to `ios.infoPlist` so Add to Calendar keeps working, Android keeps `READ_CALENDAR` and `WRITE_CALENDAR`, which the plugin adds (expo-calendar asks for both together on Android). Checked with `npx expo config --type introspect` on native-207: `NSCalendarsFullAccessUsageDescription` and `NSCalendarsUsageDescription` carry the text above, `NSCalendarsWriteOnlyAccessUsageDescription` the add only text, no reminders keys, and both Android permissions. `app/test/leaveby206.test.mjs` on native-207 checks this config. Commits 8c5dd94 and e5a6cc2. No EAS build was run for it.

## What it reads and what leaves the phone

* Read on the phone: events from now to 6 hours ahead in every calendar on the phone (`getCalendarsAsync`, `getEventsAsync`), kept to id, title, start, end, location, all day and status. Read only: nothing creates, changes or deletes an event.
* Shown on Home only: the event title.
* Skipped: all day and cancelled events, events that started, events with no location, online meetings (Zoom, Teams, Meet, Webex, links), and anything the place search can't match (a room number).
* Sent to the server, and nothing else:
  1. The place: the first line of the event's location with a leading room, level or floor dropped (at most 80 characters), as a place search, the same search as typing it into Plan (`/api/places` on api.transportsydney.app, stops only from `/api/search` when that answers 404). Only once per place: the result is kept on the phone for 30 days (a place that found nothing is tried again after a day; at most 60 places), and forgotten when the switch is turned off or with Delete all my data. A result has to share a word with the location, so a code like "Room 4.02" never becomes a random stop.
  2. The trip query: from your start stop to the place found, Arrive by the start time (the day only for an event after midnight, on api.transportsydney.app), with no install id, profile or names, so the server can't keep it in trip history or link it to your phone.
* Never sent: the event's name, notes, people, calendar name, or which calendar it came from.
* If you tap the line, the trip screen works as it always does (a trip you open is a normal trip search).

The server keeps nothing from these two requests beyond its usual short lived in memory copy of place search answers by search text (up to 6 hours, not linked to any phone), as it does for every search.

## Where the trip starts

The commute card's start (Home before 12, Work after, as on Home), else the first trip on Home, else Home or Work. With none of these set, nothing shows. An event at that same place shows nothing.

## Battery

No background fetch, no background location. The calendar is read only while Home is on screen with the app in front, at most once per 5 minutes (`useScreenPoll` with `staleMs` of 5 minutes; nothing when another screen is open or the phone is locked), for at most 2 events, one trip query each per read. A change of start place (the commute card flipping at 12) plans again from the last read without reading the calendar again.

## Testing

* Unit tests: `app/test/calendarleaveby.test.mjs` (10 tests: locations, which events, place match, cache, start place, the trip to take, the words, trip screen params, the Arrive by trip to open, the build gate, and source checks that it is off by default, read only, sends no install id or profile and polls only through useScreenPoll).
* Web: `__TRANSPORT_CALENDAR_MOCK__` on `window` (an array of events) turns on a mock calendar in a development build only (`__DEV__` and web; a release ignores it). Screenshots in `files/calendar-leaveby-25oct/` (Metro dev server, 390 x 844 and 844 x 390): two events labelled MOCK, with places, trips and times live from the server on 25 Oct (Barangaroo found as Barangaroo Station, a T9 then Metro trip; "Level 2, Five Dock Shops" searched as "Five Dock Shops"; a "Microsoft Teams Meeting" event skipped).
* Device: docs/TEST_PLAN.md on branch native-207, Build 208 checklist: Calendar leave by.
