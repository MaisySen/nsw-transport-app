# Last way home reminder

"Remind me 15 min before" on the last service home: on the Ask answer to "Last train home" and on the last service tonight in trip results (only when the list shows the night gap after it). One notification 15 minutes before you need to leave.

## Two ways to deliver it (`chooseLastPath` in `app/src/lib/lastHomeCore.ts`)

| Phone and server | Who sends it | Live recheck |
| --- | --- | --- |
| iPhone, new server (`/api/last-home` answers) | The server push (docs/API.md, Last way home reminder) | On the server, from 20 min before, also while the app is closed |
| iPhone, current server (no `/api/last-home`, 404) | The phone: one local notification | While the app is open |
| Android, either server | The phone: one local notification (Android has no server push before versionCode 6) | While the app is open |

The phone's own reminder was added on 25 Oct, 5 PM. Before it, Remind me was hidden on the current server and Android only showed the reminder on Home.

## The phone's own reminder (`app/src/lib/lastHome.ts`)

* The service comes with the hint: from the Ask answer the current server already gives (`kind: lastService`, its `last` journey, cut to a few fields by `slimLast`) or from the trip results. Nothing new is asked of the server to set it.
* One local notification (`expo-notifications` DATE trigger, identifier `last-home-local`, Android channel "Leave now reminders") at leave time minus 15 min. Builds 201 to 206 have the DATE trigger (Remind me on the commute card uses it); `localLastSupported()` checks it and hides the button when it is missing. Notification permission is asked at the tap, not before.
* Words, written when it is scheduled: "Last train to Strathfield" / "Leave by 12:45am for the 12:54am T4 from Kings Cross, Platform 1. It's the last one tonight." A tap opens the trip (from a stop) or Home (from a spot on the map).
* Live recheck, only while the app is open: on opening the app and from the app poll (`startAppPoll`, 60 s, only in the foreground), throttled to every 5 min, and every minute in the last 25 min before leaving (`recheckDue`). From a stop it asks `/api/trip` from 45 min before the service; from a spot on the map it asks Ask's Last train home again. `followLast`: the same service with a new live time moves the notification; a cancelled or vanished one is replaced by the last one still running within 3 hours ("The 12:54am T4 is cancelled. Following the 12:24am T4 instead."); with none left the notification is cancelled and Home says "No other service home shows for tonight. Open Plan for other ways home."
* What it cannot do: follow the service while the app is closed. If the last service is cancelled after you last opened the app, the notification still rings at the old time. Open the app once in the evening and it checks again. The server push (new server, iPhone) does follow it.
* Home card: the same card as the server reminder (Leaves, Reminder at, then Leave in N min), with Cancel.
* Delete all my data cancels it.

## Tests

`app/test/lasthome-local.test.mjs` (a real Ask answer from the current server, who sends it, the words, a late service, a cancelled one with and without another, the night gap, the recheck schedule).
