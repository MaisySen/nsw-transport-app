# Play Data safety form answers

Matches Android versionCode 5 with the over the air updates up to 24 Oct 2026 (live trip and Share trip, Park and Ride and lift outage alerts). Re-check this form whenever the app starts collecting something new.

Does your app collect or share any of the required user data types? Yes.
Is all of the user data collected by your app encrypted in transit? Yes (HTTPS only).
Do you provide a way for users to request that their data is deleted? Yes. In the app: Settings > Clear history > Delete my trip history on server, or Delete all my data. By email: bidur@mail.tab.bot. Deletion page: https://nsw-transport-bot.sites.tab.bot/support/#delete
Account creation: the app has no accounts.

Data shared with third parties: None.
* A Share trip link is sent by the user to people they choose, so it is a user initiated transfer, which Play does not count as sharing.
* Transport for NSW receives only the stop and trip requests the server makes, with no user data.
* Map tiles come from OpenFreeMap, which sees the phone's IP address like any web request.
* Push alerts go through Expo's push service and Google's Firebase Cloud Messaging, which act as service providers and see only the push token and the alert text.

## Data collected

| Data type | Collected | Ephemeral | Required or optional | Purpose |
| --- | --- | --- | --- | --- |
| Location: Approximate location | Yes | Yes, processed ephemerally, not stored | Optional (Nearby, Opal machines, Park and Ride list, trip from where you are) | App functionality |
| Location: Precise location | Yes | No. Only when the user turns on Share trip with "Include my location": the server keeps the latest position while the shared trip is live and deletes it when the trip ends, at most 6 hours. Everywhere else it is processed on the phone or ephemerally and not stored. | Optional | App functionality |
| App activity: In-app search history | Yes (trips planned, stop boards opened, Ask questions; trip searches kept 90 days) | No | Required | App functionality (commute suggestions, Ask answers) |
| App activity: Other user-generated content | Yes (saved trip names and stops, home and work stops, commutes) | No | Optional | App functionality |
| App activity: Other actions | Yes (trips and services watched for alerts, kept 30 days; stations chosen for lift outage alerts; car parks chosen for Nearly full alerts) | No | Optional | App functionality |
| Device or other IDs | Yes (a random install ID and a random profile ID made by the app, and the push notification token when alerts are on) | No | Required | App functionality |

## Not collected

Personal info (name, email, address, phone), financial info, health and fitness, messages, photos and videos, audio, files and docs, calendar, contacts, web browsing, app info and performance (no crash or analytics SDK), advertising ID.

## Security practices section

* Data is encrypted in transit: Yes.
* You can request that data be deleted: Yes (in the app and by email, see above).
* Committed to the Play Families policy: No (not designed for children).
* Independent security review: No.
