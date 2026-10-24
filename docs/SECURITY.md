# Security

Where every secret lives, by name only, and the rules that keep them out of the code. No secret value appears in this repository. Updated 24 Oct 2026.

## Rules

1. No secret in git, commit messages, issues, screenshots or logs. The repo is public.
2. The backend source holds placeholders (`__TFNSW_API_KEY__` and so on). `backend/build.mjs` fills them in at build time from `backend/.env`, which is ignored by git.
3. Values only ever go into the server side `worker.mjs`. The web app, the Android app and the iPhone app hold no secrets. `backend/test/site.test.mjs` checks that no API key is in the public files or the source.
4. Owner credentials are sent to Bidur by email from bidur@mail.tab.bot, organised by service, and resent in full whenever one changes.
5. Rotate a secret the moment it may have leaked. Steps per secret: [Runbook, section 7](RUNBOOK.md#7-rotate-keys).

## Secret inventory

| Secret | What it protects | Where it lives |
| --- | --- | --- |
| `TFNSW_API_KEY` | Transport for NSW Open Data API (Bronze plan, 60,000 calls a day) | `backend/.env` on the build box; inside the deployed worker |
| `VAPID_PRIVATE_KEY` | Signs Web Push notifications | `backend/.env`; deployed worker |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | Public by design, served at `/api/push/key` | `backend/.env`; deployed worker |
| `TICK_KEY` | Lets the scheduler call `/api/tick` | `backend/.env`; deployed worker; the cron-job.org job URL |
| `ADMIN_KEY` | Admin and test endpoints: `/api/stats`, `/api/feedback` (read), `/api/admin/*`, forced ticks | `backend/.env`; deployed worker |
| Transport for NSW Open Data login | The account that owns the API key | Credentials email; build box secrets folder |
| Expo account login and access token | EAS Update and EAS builds (account `bidurtab`) | Credentials email; build box secrets folder; `EXPO_TOKEN` in the build environment |
| cron-job.org login and API key | The minute scheduler job | Credentials email; build box secrets folder |
| Android upload keystore (`nsw-transport-release.jks`, alias `nswtransport`) and its passwords | Signs every Android APK and AAB. Losing it means a Play upload key reset | `~/.nsw-secrets/` on the build box (`nsw-transport-release.jks`, `android-keystore.json`); a copy was emailed to Bidur |
| Appetize login and API token | Android emulator previews in the browser (free minutes used up) | Credentials email; `~/.nsw-secrets/appetize.json` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` | App Store Connect API key for signing and TestFlight upload | Not created yet. Will be GitHub Actions repository secrets, never files in the repo |
| Play service account key | Command line Play uploads (`store/play-upload.mjs`) | Not created yet. Will stay on the build machine |
| GitHub | Repository access | Bidur's own account `MaisySen`, connected to Tab by authorization. No password or token stored in the project |
| bidur@mail.tab.bot | Project mailbox for sign ups, resets and store invites | Tab's own mailbox; no separate password |

Admin keys are passed as a `key` query parameter today. Treat any URL that contains one as a secret: do not share it or paste it into a chat.

## Data the service keeps

* No accounts, names, emails (except an optional email on the contact form) or advertising IDs.
* Each install has a random profile id. Saved trips, commutes, searches and watches are stored per profile or device.
* Trip searches are deleted after 90 days, finished watches after 30 days.
* The page counter keeps one total per day, page and referring site. No cookies, IP addresses or browser details. Do Not Track and Global Privacy Control are respected.
* Push subscriptions and Expo tokens are stored per device and removed when they fail or the user turns alerts off.

The full policy is at https://nsw-transport-bot.sites.tab.bot/privacy/ and in [store/privacy-policy.md](../store/privacy-policy.md).

## Reporting a problem

Email bidur@mail.tab.bot. A security review of the code is under way on 24 Oct 2026; its findings will be added here.
