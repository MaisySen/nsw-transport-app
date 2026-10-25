# Trip reminders

Several reminders per saved trip, each at a clock time on the weekdays you choose (25 Oct 2026, over the air update).

* Where: open a saved trip (Your trips) and scroll to REMINDERS under the services: Add a reminder, then a time wheel and Mo to Su day buttons. A new one starts 15 minutes before the first service shown, on weekdays. Up to 6 per trip. Tap one to change or delete it.
* How it rings: each day of a reminder is one weekly local notification on the phone (`expo-notifications` WEEKLY trigger, identifier `trip-rem|<trip key>|<reminder>|<weekday>`), on the Android channel "Trip reminders". It rings with the app closed. Nothing polls and nothing goes to the server. The words are fixed ("Time to check your trip. Tap for live times.") so they are never out of date; a tap opens the trip with live times.
* Permission: asked only when the first reminder is saved. If it is refused, nothing is saved and the app offers Settings.
* Which builds: builds 201 to 206 have `expo-notifications` 58 (local scheduling is already used by Wake me and Remind me), so this ships over the air. The app still checks the WEEKLY trigger type and the scheduling calls are there (`remindersSupported()`), and hides the section when they are not.
* Clean up: deleting a trip cancels its reminders 8 s later (after Home's Undo, so Undo keeps them; an edit that keeps the same stops keeps them). Delete all my data cancels them all.
* Times are the phone's clock, like the phone's own alarms.
* Code: `app/src/lib/reminderCore.ts` (tested in `app/test/reminders.test.mjs`), `app/src/lib/reminders.ts`, `app/src/components/TripReminders.tsx`, the tap in `app/src/app/_layout.tsx`.
