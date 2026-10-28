package com.maisysen.nswtransport.widget

/**
 * When a widget may still call a time live (build 209). The same rule as the app's rows
 * (app/src/lib/liveLabelCore.ts, 28 Oct liveness pass) and the iPhone widgets (targets/widget/WidgetLive.swift):
 * a live time whose data is over 5 minutes old (LIVE_MAX_MS), or over 2 minutes old (STALE_DATA_MS) for a service
 * under 10 minutes away (STALE_NEAR_MS), shows its timetable time instead, as Scheduled.
 *
 * The data's age counts from the feed's own time where the answer has it (a board row's liveAt, the answer's
 * live.feedTs), else the newest fetch (live.feedAt), else when the widget asked; the server's "now" turns it into
 * the phone's clock. No timer of its own: the trip widget's one refresh alarm is moved up to the moment its first
 * live time would stop being live, and the board already refreshes about every minute while the screen is on.
 */
object WidgetLive {
    const val MAX_AGE_MS = 300_000L
    const val NEAR_AGE_MS = 120_000L
    const val NEAR_WINDOW_MS = 600_000L
    private const val MAX_TRUST_MS = 86_400_000L

    /** When the live data was made, on the phone's clock. 0 or less for feedMs or serverNowMs means not sent. */
    fun dataAt(fetched: Long, feedMs: Long, serverNowMs: Long): Long {
        if (feedMs <= 0) return fetched
        var age = if (serverNowMs > 0) serverNowMs - feedMs else fetched - feedMs
        if (age < 0) age = 0
        if (age > MAX_TRUST_MS) age = MAX_TRUST_MS
        return fetched - age
    }

    /** Whether a live time for a service leaving at [leave], from data made at [dataAt], is still live at [at]. */
    fun isFresh(dataAt: Long, leave: Long, at: Long): Boolean {
        val age = at - dataAt
        if (age > MAX_AGE_MS) return false
        if (leave - at < NEAR_WINDOW_MS && age > NEAR_AGE_MS) return false
        return true
    }

    /** The first moment that live time is no longer live: what the trip widget's refresh alarm is capped at. */
    fun staleAt(dataAt: Long, leave: Long): Long =
        minOf(dataAt + MAX_AGE_MS + 1, maxOf(dataAt + NEAR_AGE_MS + 1, leave - NEAR_WINDOW_MS + 1))

    /** The timetable time behind a live one: [leave] less the first service's delay; 0 when unknown. */
    fun timetable(leave: Long, live: Long, planned: Long): Long = if (live > 0 && planned > 0) leave - (live - planned) else 0
}
