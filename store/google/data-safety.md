# Play Data safety form answers

Does your app collect or share any of the required user data types? Yes.
Is all of the user data collected by your app encrypted in transit? Yes (HTTPS only).
Do you provide a way for users to request that their data is deleted? Yes: email bidur@mail.tab.bot, and saved trips, commutes and watches can be deleted in the app. Deletion page: https://nsw-transport-bot.sites.tab.bot/support/#delete
Account creation: the app has no accounts.

Data shared with third parties: None. (Transport for NSW receives only the stop and trip requests the server makes, with no user data. Map tiles come from OpenFreeMap, which sees the phone's IP address like any web request.)

Data collected:

| Data type | Collected | Ephemeral | Required or optional | Purpose |
| --- | --- | --- | --- | --- |
| Location: Approximate location | Yes | Yes, processed ephemerally, not stored | Optional (only when you tap Stops near me) | App functionality |
| Location: Precise location | Yes | Yes, processed ephemerally, not stored | Optional | App functionality |
| App activity: In-app search history | Yes (trips planned or watched, kept 90 days) | No | Required | App functionality (commute suggestions) |
| App activity: Other user-generated content | Yes (saved trip names and stops, commutes) | No | Optional | App functionality |
| Device or other IDs | Yes (a random install ID made by the app, and the push notification token when alerts are on) | No | Required | App functionality |

Not collected: personal info (name, email, address, phone), financial info, health, messages, photos, audio, files, calendar, contacts, web browsing, app info and performance (no crash or analytics SDK), advertising ID.
