# Android permissions (release APK and AAB, versionCode 5)

Read from the vc5 APK with aapt2 on 24 Oct 2026.

| Permission | Why |
| --- | --- |
| INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE | Live times from the server; network state lets the app retry when the connection comes back |
| ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION | Nearby stops, Opal machines and Park and Ride closest first, planning a trip from where you are, and your dot on the live trip map. Asked only when you use those, foreground only. No background location. |
| POST_NOTIFICATIONS | Alerts you choose: watched trips (leave now, running late, platform change, connection at risk), get off alerts on a live trip, the Trip in progress notification, lift outages and car parks nearly full |
| VIBRATE | Haptic feedback and alert vibration |
| RECEIVE_BOOT_COMPLETED, WAKE_LOCK | Added by the notifications library and WorkManager so scheduled alerts survive a restart |
| com.google.android.c2dm.permission.RECEIVE | Push alerts through Firebase Cloud Messaging (not set up yet, see app/NEEDS_BIDUR.md) |
| DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION | Added by AndroidX so the app's own broadcast receivers are private to the app |
| com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE | Added by a dependency. The app never reads the install referrer. Blocked in app.json from the next native build (versionCode 6), so it will not be in that build |

Removed for the store build (blockedPermissions in app.json and plugins/withStoreManifest.js): RECORD_AUDIO, SYSTEM_ALERT_WINDOW, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, ACCESS_BACKGROUND_LOCATION, READ_APP_BADGE and the launcher badge permissions, and the two expo-location foreground location services. Play therefore asks for no sensitive permission declarations (no background location, no foreground service types, no overlay).

Sensitive permission declarations in Play Console: none needed.
