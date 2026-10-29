# Data safety answers (Google Play Console)

The answers for Play Console, App content, Data safety. Source file; docs/STORE_PRIVACY.md points here. The Play app is not created yet, so nothing is filled in.

Checked against the code on 26 Oct 2026, 5:50 PM Sydney (g25), with the same checks and fixes as [../apple/app-privacy.md](../apple/app-privacy.md). One row changed: Precise location now also names the last way home reminder set from where you are. "Approximate location: processed ephemerally Yes" is true again since the server stopped keeping request addresses in its logs (transport-api `3e88773d`, 26 Oct); before that a sample of nearby stop positions sat in the logs for up to 7 days.

## Answers (Play Console > App content > Data safety)

* Does your app collect or share any of the required user data types? Yes.
* Is all of the user data collected by your app encrypted in transit? Yes.
* Do you provide a way for users to request that their data is deleted? Yes (Delete all my data in More; privacy@transportsydney.app; https://transportsydney.app/support/).
* Account creation: the app does not have accounts.
* Data shared with third parties: None. Share trip is a user initiated transfer. Expo, Google, Cloudflare and Sentry (crash reports, from build 209) act as service providers.

| Data type | Collected | Processed ephemerally | Required or optional | Purpose |
| --- | --- | --- | --- | --- |
| Location: Approximate location | Yes | Yes | Optional | App functionality |
| Location: Precise location | Yes | No (only by choice: Include my location on Share trip, at most 6 hours; a last way home reminder set from where you are, until 12 hours after the service) | Optional | App functionality |
| App activity: In-app search history | Yes | No (90 days) | Required | App functionality |
| App activity: Other user-generated content | Yes | No | Optional | App functionality |
| App activity: Other actions | Yes (watched services, checks, chosen car parks and stations) | No | Optional | App functionality |
| App info and performance: Crash logs | Yes (crash safety net since 27 Oct; Sentry from build 209) | No | Required | App functionality |
| Device or other IDs | Yes (random install and profile IDs; push token once Android push ships) | No | Required | App functionality |

Not collected: personal info, financial info, health and fitness, messages, photos and videos, audio, files and docs, contacts, web browsing, app info and performance other than crash logs (no diagnostics or performance data), advertising ID. Calendar: not collected while Android versionCode 5 (no calendar module) is the build in use. When an Android build with the calendar module ships, add the row "Calendar: Calendar events | Yes | Yes | Optional | App functionality": with Calendar leave by on, an event's place leaves the phone as a search (no ID, not kept), which Play counts as collected and processed ephemerally. That build also lists READ_CALENDAR and WRITE_CALENDAR.

Security: encrypted in transit Yes; deletion request Yes; Families policy No; independent security review No.

Crash logs (27 Oct): exact answers and reasons in [../../docs/STORE_PRIVACY.md](../../docs/STORE_PRIVACY.md), Crash data. The code facts behind these rows are in [../apple/app-privacy.md](../apple/app-privacy.md).
