# Store privacy answers

Moved on 26 Oct 2026 (g25) into the store pack, next to the listing:

* App Store App Privacy answers and the code facts behind them: [store/apple/app-privacy.md](../store/apple/app-privacy.md)
* Google Play Data safety answers: [store/google/data-safety.md](../store/google/data-safety.md)
* The published privacy policy: https://transportsydney.app/privacy/ (source `site/privacy/index.html`, text copy [store/privacy-policy.md](../store/privacy-policy.md))

Re-check whenever the app or server starts keeping something new, and update all three together.

## Crash data (27 Oct 2026, branch sentry-build209)

Two things now send crash data, so both stores must list it:

1. The crash safety net, live since the 27 Oct, 11:14 AM update on every build: each caught error and each fatal error goes once to the server's feedback inbox (D1 table `feedback`, page `crash:<screen>`) with the error, the top of the stack, the build, the update id, the last server paths asked (no query values) and the install ID. At most 3 a run.
2. Sentry, from native build 209 (1 Nov): JavaScript errors and native crashes go to Sentry (US region, organisation `fintex-australia-bk`), cleaned on the phone of stop, route and place names, positions, query values, IDs, the phone's name and the IP address. Details: [SENTRY.md](SENTRY.md).

Neither is linked to a name, email or account (there are none), neither is used for tracking, and Sentry receives no install or profile ID. Sentry is a service provider processing crash reports for Fintex, so this is not sharing under Play's definition.

### App Store Connect, App Privacy (add one data type; the other four stay)

1. App Privacy > Edit. Tick **Diagnostics > Crash Data**. Do not tick Performance Data or Other Diagnostic Data (no hang reports, traces, profiling or sessions are collected).
2. Crash Data, purposes: **App Functionality** only (Apple lists "minimize app crashes" under App Functionality). Not Analytics, not Third Party Advertising, not Developer's Advertising, not Product Personalization.
3. Is crash data linked to the user's identity? **No.**
4. Is crash data used for tracking? **No.**
5. Publish.

Result: "Data Not Linked to You" lists Location, Search History, Identifiers, User Content and Diagnostics. "Data Used to Track You": none. The privacy manifest (`app/app.json`, `NSPrivacyCollectedDataTypeCrashData`, not linked, no tracking, App Functionality) says the same from build 209; the Sentry SDK brings its own manifest for the APIs it calls.

### Google Play Console, Data safety (add one row; the other rows stay)

* Data type: **App info and performance > Crash logs.**
* Collected: **Yes.** Shared: **No** (Sentry and Cloudflare act as service providers).
* Processed ephemerally: **No** (Sentry keeps events for its plan's retention, 30 days on the free plan; the feedback inbox keeps them until deleted, at most 12 months).
* Required or optional: **Required** (the app has no switch to turn crash reports off; the server's `sentry` flag turns Sentry off for everyone).
* Purpose: **App functionality.**
* App info and performance > Diagnostics: **not collected** (no performance data). Other app performance data: **not collected.**

The Play app is not created yet; fill these in with the rest of Data safety when it is.

### When to change what

* Now (the crash net is already live on builds 201 to 208): add Crash Data in App Store Connect and the Crash logs row in the Play draft, and add the policy lines below. The published answers do not list crash data today.
* 1 Nov (build 209): nothing more to tick; Sentry is inside the same answers. Re-check that the first Sentry events carry nothing outside the list in SENTRY.md.

### Privacy policy lines (done)

Published on transportsydney.app/privacy/ from main (live page reads Updated 30 October 2026): the short version says the app sends a crash report if it crashes, the Crash reports section covers both our server and "a crash reporting service in the United States" (from app build 209), and Who else is involved lists that service with its 30 day keep, no install ID, no stored IP address and screenshots, session recording and performance tracking off. Since 30 Oct the policy names service categories, not vendors (owner's approval), so the line below is kept only as the record of what was proposed on 27 Oct. Nothing is left to add for build 209.

Proposed on 27 Oct (superseded by the published wording):

* In the short version, after "no third party tracking": "If the app crashes, it sends a crash report so we can fix it."
* Under what the app sends: "**Crash reports.** When the app hits an error or crashes, it sends a report: the error, where in the app's code it happened, the app version and build, the update, your phone's model and system version, and the last parts of our server the app asked (without what you searched for). Reports sent to our server also carry the app's random install ID. We keep them until the fault is fixed, at most 12 months. They never include your position, stops, trips, searches, your phone's name or your IP address."
* Under service providers: "**Sentry** (from app build 209) receives crash reports for us and keeps them for up to 30 days. It does not receive your install ID or your IP address, and we have turned off its screenshots, session recording and performance tracking."
