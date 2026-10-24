package com.maisysen.nswtransport.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import com.maisysen.nswtransport.R
import kotlin.concurrent.thread

/** Home screen widget: the next services for a trip, with a countdown that ticks every second. */
class TripWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val done = goAsync()
        thread {
            try { ids.forEach { update(context, manager, it) } } finally { done.finish() }
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        onUpdate(context, manager, intArrayOf(id))
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        ids.forEach { WidgetPrefs.clear(context, it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            val ids = if (id == AppWidgetManager.INVALID_APPWIDGET_ID)
                manager.getAppWidgetIds(ComponentName(context, TripWidgetProvider::class.java)) else intArrayOf(id)
            onUpdate(context, manager, ids)
        }
    }

    companion object {
        const val ACTION_REFRESH = "com.maisysen.nswtransport.widget.REFRESH"

        /** Fetches and draws one widget. Call off the main thread. */
        fun update(context: Context, manager: AppWidgetManager, id: Int) {
            TransitApi.init(context)
            val cfg = WidgetPrefs.load(context, id)
            val choice = if (cfg == null) TransitApi.smart() else cfg
            if (choice == null) {
                manager.updateAppWidget(id, views(context, manager, id) { v, medium ->
                    v.setTextViewText(R.id.title, "Transport")
                    v.setTextViewText(R.id.subtitle, "")
                    message(v, "Touch and hold the widget to pick a trip.")
                    v.setOnClickPendingIntent(R.id.root, configIntent(context, id))
                })
                return
            }
            val result = try { TransitApi.trips(choice) } catch (e: Exception) { null }
            val vias = choice.vias()
            val now = System.currentTimeMillis()
            manager.updateAppWidget(id, views(context, manager, id) { v, medium ->
                val fromName = result?.fromName ?: TransitApi.shortName(choice.from.name)
                val toName = result?.toName ?: TransitApi.shortName(choice.to.name)
                v.setTextViewText(R.id.title, choice.title)
                v.setTextViewText(R.id.subtitle, when {
                    medium && vias.isNotEmpty() -> "$fromName to $toName via ${vias.joinToString(", ")}"
                    medium -> "$fromName to $toName"
                    vias.isNotEmpty() -> "to $toName, ${vias.size + 1} legs"
                    else -> "to $toName"
                })
                v.setOnClickPendingIntent(R.id.root, openTrip(context, id, choice, fromName, toName))
                v.setOnClickPendingIntent(R.id.refresh, refreshIntent(context, id))
                val trips = result?.trips ?: emptyList()
                val t = trips.firstOrNull()
                if (t == null) {
                    message(v, if (result == null) "Live times will be back shortly." else "No trips soon.")
                    v.setTextViewText(R.id.next, "")
                } else {
                    v.setViewVisibility(R.id.badge_row, View.VISIBLE)
                    v.setTextViewText(R.id.badge, t.line)
                    tint(v, R.id.badge, t.color)
                    v.setTextColor(R.id.badge, if (prefersWhite(t.color)) Color.WHITE else Color.BLACK)
                    chainBadges(v, t, medium)
                    val left = t.leave - now
                    if (left in 0 until 3_600_000) {
                        v.setViewVisibility(R.id.countdown, View.VISIBLE)
                        v.setViewVisibility(R.id.clock, View.GONE)
                        v.setChronometer(R.id.countdown, SystemClock.elapsedRealtime() + left, null, true)
                        v.setChronometerCountDown(R.id.countdown, true)
                    } else {
                        v.setViewVisibility(R.id.countdown, View.GONE)
                        v.setViewVisibility(R.id.clock, View.VISIBLE)
                        v.setTextViewText(R.id.clock, if (left < 0) "Now" else TransitApi.clock(t.leave))
                    }
                    val walk = ((t.board - t.leave) / 60_000).toInt()
                    val status = when {
                        choice.multi && t.arrive > 0 -> "Arrive ${TransitApi.clock(t.arrive)}, ${duration(t.minutes)}" + (if (medium) ". ${t.status}" else "")
                        walk > 0 -> "$walk min walk first. ${t.status}"
                        else -> t.status
                    }
                    val notice = result?.notice
                    v.setTextViewText(R.id.status, if (!medium && notice != null) notice else status)
                    v.setTextColor(R.id.status, when {
                        !medium && notice != null -> if (result?.severe == true) RED else ORANGE
                        t.cancelled -> RED
                        choice.multi -> context.getColor(R.color.widget_text)
                        !t.live -> context.getColor(R.color.widget_secondary)
                        t.status.contains("late") -> ORANGE
                        else -> GREEN
                    })
                    if (medium) {
                        val then = trips.drop(1).take(3).joinToString("\n") { x ->
                            val w = ((x.leave - now) / 60_000).toInt()
                            if (choice.multi) "${TransitApi.clock(x.leave)}  ${x.lines.joinToString(" ") { it.name }}  arr ${TransitApi.clock(x.arrive)}" +
                                (if (x.risk == "tight") "  Tight" else if (x.risk == "miss") "  Missed" else "")
                            else "${TransitApi.clock(x.leave)}   ${x.line}   ${if (w <= 0) "Now" else "$w min"}   ${x.status}"
                        }
                        v.setTextViewText(R.id.next, if (then.isEmpty()) "No more services soon" else then)
                        v.setTextViewText(R.id.notice, notice ?: "Updated ${TransitApi.clock(now)}")
                        v.setTextColor(R.id.notice, if (notice == null) context.getColor(R.color.widget_secondary) else if (result?.severe == true) RED else ORANGE)
                    }
                }
            })
            // Fresh data when the next service leaves, and at least every 15 minutes.
            val next = (result?.trips?.firstOrNull()?.leave ?: now) + 30_000
            schedule(context, id, next.coerceIn(now + 60_000, now + 15 * 60_000))
        }

        private fun duration(m: Int) = if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"

        /** Line badges for the first services of a multi leg trip (up to 3), or one badge and the platform. */
        private fun chainBadges(v: RemoteViews, t: TransitApi.Trip, medium: Boolean) {
            val lines = if (t.lines.size > 1) t.lines else emptyList()
            val ids = listOf(R.id.badge2 to R.id.sep2, R.id.badge3 to R.id.sep3)
            val maxBadges = if (medium) 3 else 2
            ids.forEachIndexed { i, (b, s) ->
                val l = lines.getOrNull(i + 1)
                if (l == null || i + 1 >= maxBadges) { v.setViewVisibility(b, View.GONE); v.setViewVisibility(s, View.GONE); return@forEachIndexed }
                v.setViewVisibility(b, View.VISIBLE); v.setViewVisibility(s, View.VISIBLE)
                v.setTextViewText(b, l.name)
                tint(v, b, l.color)
                v.setTextColor(b, if (prefersWhite(l.color)) Color.WHITE else Color.BLACK)
            }
            val more = lines.size - maxBadges
            v.setTextViewText(R.id.platform, when {
                lines.isEmpty() -> t.platform?.replace("Platform", "Plat") ?: ""
                more > 0 -> "+$more"
                medium -> t.platform?.replace("Platform", "Plat") ?: ""
                else -> ""
            })
        }

        private val RED = Color.parseColor("#FF3B30")
        private val ORANGE = Color.parseColor("#FF9500")
        private val GREEN = Color.parseColor("#34C759")

        private fun prefersWhite(c: Int): Boolean {
            val l = 0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)
            return l < 170
        }

        private fun tint(v: RemoteViews, viewId: Int, color: Int) {
            if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(viewId, "setBackgroundTintList", ColorStateList.valueOf(color))
            else v.setInt(viewId, "setBackgroundColor", color)
        }

        private fun message(v: RemoteViews, text: String) {
            v.setViewVisibility(R.id.badge_row, View.INVISIBLE)
            v.setViewVisibility(R.id.countdown, View.GONE)
            v.setViewVisibility(R.id.clock, View.GONE)
            v.setTextViewText(R.id.status, text)
        }

        /** Small layout for 2 by 2, medium for wider; Android 12 and later pick by size themselves. */
        private fun views(context: Context, manager: AppWidgetManager, id: Int, fill: (RemoteViews, Boolean) -> Unit): RemoteViews {
            val small = RemoteViews(context.packageName, R.layout.widget_trip_small).also { fill(it, false) }
            val medium = RemoteViews(context.packageName, R.layout.widget_trip_medium).also { fill(it, true) }
            if (Build.VERSION.SDK_INT >= 31) {
                return RemoteViews(mapOf(SizeF(100f, 100f) to small, SizeF(230f, 100f) to medium))
            }
            val w = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
            return if (w >= 230) medium else small
        }

        private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        /** Opens the trip screen; a multi leg trip opens with all its legs. */
        fun tripUri(choice: TransitApi.Choice, fromName: String = TransitApi.shortName(choice.from.name), toName: String = TransitApi.shortName(choice.to.name)): Uri {
            val b = Uri.parse("nswtransport://trip").buildUpon()
                .appendQueryParameter("from", choice.from.id).appendQueryParameter("fromName", fromName)
                .appendQueryParameter("to", choice.to.id).appendQueryParameter("toName", toName)
            choice.legs?.let { b.appendQueryParameter("legs", TransitApi.appLegs(it)).appendQueryParameter("name", choice.title) }
            return b.build()
        }

        private fun openTrip(context: Context, id: Int, choice: TransitApi.Choice, fromName: String, toName: String): PendingIntent {
            val uri = tripUri(choice, fromName, toName)
            val i = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, id, i, flags())
        }

        private fun configIntent(context: Context, id: Int): PendingIntent {
            val i = Intent(context, TripWidgetConfigActivity::class.java)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, 200_000 + id, i, flags())
        }

        fun refreshIntent(context: Context, id: Int, code: Int = 100_000 + id): PendingIntent {
            val i = Intent(context, TripWidgetProvider::class.java).setAction(ACTION_REFRESH)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            return PendingIntent.getBroadcast(context, code, i, flags())
        }

        private fun schedule(context: Context, id: Int, at: Long) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.set(AlarmManager.RTC, at, refreshIntent(context, id, 300_000 + id))
        }
    }
}

/** Which trip each widget follows. No entry means Smart. */
object WidgetPrefs {
    private fun prefs(c: Context) = c.getSharedPreferences("transport_widgets", Context.MODE_PRIVATE)

    fun save(c: Context, id: Int, choice: TransitApi.Choice?) {
        val e = prefs(c).edit()
        if (choice == null) e.putString("w$id.kind", "smart")
        else e.putString("w$id.kind", "trip").putString("w$id.title", choice.title)
            .putString("w$id.from", choice.from.id).putString("w$id.fromName", choice.from.name)
            .putString("w$id.to", choice.to.id).putString("w$id.toName", choice.to.name)
            .putString("w$id.legs", choice.legs)
        e.apply()
    }

    fun load(c: Context, id: Int): TransitApi.Choice? {
        val p = prefs(c)
        if (p.getString("w$id.kind", "smart") != "trip") return null
        return TransitApi.Choice(p.getString("w$id.title", "Trip") ?: "Trip",
            TransitApi.Stop(p.getString("w$id.from", "") ?: "", p.getString("w$id.fromName", "") ?: ""),
            TransitApi.Stop(p.getString("w$id.to", "") ?: "", p.getString("w$id.toName", "") ?: ""),
            p.getString("w$id.legs", null))
    }

    fun clear(c: Context, id: Int) {
        val e = prefs(c).edit()
        listOf("kind", "title", "from", "fromName", "to", "toName", "legs").forEach { e.remove("w$id.$it") }
        e.apply()
    }
}
