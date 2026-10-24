# App Privacy answers (App Store Connect, App Privacy)

Privacy policy URL: https://transportsydney.app/privacy/

Do you or your third party partners collect data from this app? Yes.

Tracking: No. The app does not track users across apps or websites owned by other companies, has no ads, no analytics SDK and no third party SDKs that collect data. NSPrivacyTracking is false in the privacy manifest.

Data types collected (all: used for App Functionality only, NOT linked to the user's identity, NOT used for tracking):

| Category | Data type | Why |
| --- | --- | --- |
| Identifiers | Device ID | A random install ID made by the app (not the advertising ID, not the vendor ID). The server uses it to keep the trips you watch and the alerts that belong to this phone. |
| Search History | Search History | Trips you plan or watch are kept with the random profile ID so Transport can suggest a commute (same trip on two days at a similar time). Deleted after 90 days. |
| User Content | Other User Content | Names and stops of the trips you save and your commutes, so they appear on Trips and in widgets. |

Not collected:

* Location: when you tap Show stops near me, plan from where you are, or ask Siri for the next train home, the phone sends its position for that one request. The server uses it to answer and does not store it. Under Apple's definition (not retained beyond servicing the request in real time) this is not collected. Home and work places, starred stops and recent stops stay on the phone.
* Contact info, health, financial info, contacts, browsing history, purchases, usage data, diagnostics, sensitive info: none.
* Ask questions are sent to the server to answer and are not stored.

Notifications on iPhone are local notifications made by the app. No push token is sent.

This matches the privacy manifest in the app (ios-native/Support/Privacy/App/PrivacyInfo.xcprivacy): DeviceID, SearchHistory, OtherUserContent, all not linked, no tracking, purpose App Functionality; required reason API UserDefaults with reasons CA92.1 and 1C8F.1.
