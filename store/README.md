# Store pack: Transport: Sydney Live

Everything needed for App Store Connect and the Google Play Console. Copy each field as written. Nothing here is a secret, and no personal phone number is written here (the repo is public). Checked and brought up to date on 26 Oct 2026, 5:50 PM Sydney (g25). Nothing has been submitted for review.

| File | What it is | State |
| --- | --- | --- |
| apple/listing.md | Name, subtitle, promo text, description, keywords, category, URLs | In App Store Connect, read back 26 Oct |
| apple/app-privacy.md | App Privacy answers and the code facts behind them | Published 25 Oct; rechecked 26 Oct, still correct |
| apple/review-notes.md | Points to docs/APP_REVIEW_NOTES.md: Notes for App Review (data source, how to test, permissions, system features, every server feature and switch) | In App Store Connect as a draft, read back 28 Oct (3854 characters) |
| apple/age-rating.md | Age rating answers (4+) | In App Store Connect, read back 26 Oct |
| google/listing.md | Play title, short and full description, contact details | Play app not created yet |
| google/data-safety.md | Play Data safety answers | Play app not created yet |
| google/content-rating.md | IARC answers | Play app not created yet |
| google/permissions.md | Why each Android permission is there | |
| attribution.md | Transport for NSW data credit and CC BY 4.0 terms | |
| privacy-policy.md | Text copy of https://transportsydney.app/privacy/ (source site/privacy/index.html) | Published 26 Oct |
| screenshots/ | Store screenshots and how to make them | Watch set missing, see screenshots/README.md |
| AUDIT.md | The 24 Oct guideline audit of the earlier Swift build (history) | |
| ../SUBMIT.md, ../docs/STORE.md | Submission steps and status | |

Identifiers: bundle `com.maisysen.nswtransport` (Watch `.watchkitapp`, complications `.watchkitapp.complications`), App Store Connect app 6826543653, version 1.0.0 (Prepare for Submission, build 206 attached on 26 Oct). iPhone only (`supportsTablet` false). Android application ID `com.maisysen.nswtransport`.

## What the root or owner must confirm before submitting

1. **The owner's written OK to submit.** Nothing is submitted without it.
2. **Apple Watch screenshots** (required; none uploaded). Easiest: the owner takes 3 to 5 on his watch (screenshots/README.md).
3. **Reshoot the iPhone screenshots or keep them.** The uploaded set shows the owner's own stations (Burwood, Strathfield, Kings Cross). The script now uses NSW wide stations, but needs live data: after about 1 AM, best 4:30 to 5 AM on 27 Oct.
4. **Attach the newest build** to version 1.0.0 (206 today; 208 has Calendar leave by, which the notes mention; 209 from 1 Nov).
5. **"Linked to you: No"** in App Privacy (random install IDs, no accounts). Keep, or switch all four types to Linked (apple/app-privacy.md).
6. **Opal wording**: the listing no longer says "Opal" (a Transport for NSW brand). The app itself still says "Opal fare" and "Opal machines" on screen; that names the real card and is not listing branding, so it was left alone.
7. **Alerts for saved trips and the Limited Stops tag** (worker g22, in progress): if they ship before submission, add a line each to the review notes and recheck app-privacy.md if the server keeps anything new.
8. **Organisation account**: the seller shows the owner's own name until the Apple account moves to Fintex (D-U-N-S 889795329).
