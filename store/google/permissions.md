# Android permissions (release AAB, versionCode 4)

| Permission | Why |
| --- | --- |
| INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE | Live times from the server; network state lets the app retry when the connection comes back |
| ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION | Stops near me and planning a trip from where you are. Asked only when you tap those, foreground only. No background location. |
| POST_NOTIFICATIONS | Alerts for trips you choose to watch: leave now, running late, platform change, connection at risk |
| VIBRATE | Haptic feedback and alert vibration |
| RECEIVE_BOOT_COMPLETED, WAKE_LOCK, FOREGROUND_SERVICE | Added by the notifications library and WorkManager so scheduled alerts survive a restart. No foreground service type is declared. |
| com.google.android.c2dm.permission.RECEIVE | Push alerts through Firebase Cloud Messaging |
| BIND_GET_INSTALL_REFERRER_SERVICE | Added by the Play install referrer library through Expo; nothing is sent to analytics |
| Launcher badge permissions (Samsung, Huawei, Oppo and others) | Added by the notifications library to show an unread badge on the icon |

Removed for the store build (blockedPermissions in app.json and plugins/withStoreManifest.js): RECORD_AUDIO, SYSTEM_ALERT_WINDOW, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, FOREGROUND_SERVICE_LOCATION, ACCESS_BACKGROUND_LOCATION, and the two expo-location foreground location services. Play therefore asks for no sensitive permission declarations (no background location, no foreground service types, no overlay).

Sensitive permission declarations in Play Console: none needed.
