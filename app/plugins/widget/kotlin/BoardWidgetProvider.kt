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
import android.view.View
import android.widget.RemoteViews
import com.maisysen.nswtransport.R
import kotlin.concurrent.thread

/** Large home screen widget: a live departure board for one stop, the next 4 to 6 services. */
class BoardWidgetProvider : AppWidgetProvider() {

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
        ids.forEach { BoardPrefs.clear(context, it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            val ids = if (id == AppWidgetManager.INVALID_APPWIDGET_ID)
                manager.getAppWidgetIds(ComponentName(context, BoardWidgetProvider::class.java)) else intArrayOf(id)
            onUpdate(context, manager, ids)
        }
    }

    companion object {
        const val ACTION_REFRESH = "com.maisysen.nswtransport.widget.BOARD_REFRESH"
        private val ROWS = listOf(
            arrayOf(R.id.row1, R.id.b1, R.id.d1, R.id.s1, R.id.t1), arrayOf(R.id.row2, R.id.b2, R.id.d2, R.id.s2, R.id.t2),
            arrayOf(R.id.row3, R.id.b3, R.id.d3, R.id.s3, R.id.t3), arrayOf(R.id.row4, R.id.b4, R.id.d4, R.id.s4, R.id.t4),
            arrayOf(R.id.row5, R.id.b5, R.id.d5, R.id.s5, R.id.t5), arrayOf(R.id.row6, R.id.b6, R.id.d6, R.id.s6, R.id.t6),
        )
        private val RED = Color.parseColor("#FF3B30")
        private val ORANGE = Color.parseColor("#FF9500")
        private val GREEN = Color.parseColor("#34C759")

        fun modeLabel(mode: String?) = when (mode) {
            "train" -> "Trains"; "metro" -> "Metro"; "bus" -> "Buses"; "ferry" -> "Ferries"; "lightrail" -> "Light rail"
            else -> "All services"
        }

        /** How many rows fit: 4 at the default 4 by 3 size on small phones, up to 6 when taller. */
        private fun rowsFor(manager: AppWidgetManager, id: Int): Int {
            val o = manager.getAppWidgetOptions(id)
            val h = maxOf(o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0), o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0))
            if (h <= 0) return 5
            return ((h - 70) / 38).coerceIn(2, 6)
        }

        fun update(context: Context, manager: AppWidgetManager, id: Int) {
            TransitApi.init(context)
            val cfg = BoardPrefs.load(context, id)
            val v = RemoteViews(context.packageName, R.layout.widget_board)
            if (cfg == null) {
                v.setTextViewText(R.id.title, "Departure board")
                v.setTextViewText(R.id.subtitle, "")
                empty(v, "Touch and hold the widget to pick a stop.")
                v.setOnClickPendingIntent(R.id.root, configIntent(context, id))
                manager.updateAppWidget(id, v)
                return
            }
            val board = try { TransitApi.board(cfg.stop.id, cfg.mode, 6) } catch (e: Exception) { null }
            val now = System.currentTimeMillis()
            val name = board?.stopName?.takeIf { it.isNotEmpty() } ?: TransitApi.shortName(cfg.stop.name)
            v.setTextViewText(R.id.title, name)
            // A row whose live time got too old shows as Scheduled (WidgetLive); the line then says when that data was made.
            v.setTextViewText(R.id.subtitle, modeLabel(cfg.mode) + if (board != null) ", updated ${TransitApi.clock(board.dataAt.takeIf { it > 0 } ?: now)}" else "")
            v.setOnClickPendingIntent(R.id.root, openStop(context, id, cfg.stop.id))
            v.setOnClickPendingIntent(R.id.refresh, refreshIntent(context, id))
            val n = rowsFor(manager, id)
            val items = board?.items ?: emptyList()
            if (items.isEmpty()) {
                empty(v, if (board == null) "Live times will be back shortly." else "No services in the next while.")
            } else {
                v.setViewVisibility(R.id.empty, View.GONE)
                ROWS.forEachIndexed { i, ids ->
                    val d = items.getOrNull(i)
                    if (d == null || i >= n) { v.setViewVisibility(ids[0], View.GONE); return@forEachIndexed }
                    v.setViewVisibility(ids[0], View.VISIBLE)
                    v.setTextViewText(ids[1], d.line)
                    if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(ids[1], "setBackgroundTintList", ColorStateList.valueOf(d.color))
                    else v.setInt(ids[1], "setBackgroundColor", d.color)
                    v.setTextColor(ids[1], if (prefersWhite(d.color)) Color.WHITE else Color.BLACK)
                    v.setTextViewText(ids[2], d.dest)
                    val status = when {
                        d.cancelled -> "Cancelled"
                        !d.live -> "Scheduled"
                        d.delay == null || d.delay == 0 -> "On time"
                        d.delay > 0 -> "${d.delay} min late"
                        else -> "${-d.delay} min early"
                    }
                    val plat = d.platform?.replace("Platform", "Plat")
                    v.setTextViewText(ids[3], listOfNotNull(plat, status).joinToString(", "))
                    v.setTextColor(ids[3], when {
                        d.cancelled -> RED
                        !d.live -> context.getColor(R.color.widget_secondary)
                        (d.delay ?: 0) > 0 -> ORANGE
                        else -> GREEN
                    })
                    val left = ((d.time - now) / 60_000).toInt()
                    v.setTextViewText(ids[4], when { d.cancelled -> TransitApi.clock(d.time); left <= 0 -> "Now"; left < 60 -> "$left min"; else -> TransitApi.clock(d.time) })
                    v.setTextColor(ids[4], if (d.cancelled) RED else context.getColor(R.color.widget_text))
                }
            }
            v.setTextViewText(R.id.notice, board?.notice ?: "")
            v.setViewVisibility(R.id.notice, if (board?.notice != null) View.VISIBLE else View.GONE)
            v.setTextColor(R.id.notice, ORANGE)
            manager.updateAppWidget(id, v)
            // Minutes count down, so refresh about every minute while the phone is awake (a non waking alarm), and at least every 15 minutes.
            val first = items.firstOrNull()?.time ?: (now + 15 * 60_000)
            schedule(context, id, minOf(now + 60_000, maxOf(first + 15_000, now + 60_000)))
        }

        private fun empty(v: RemoteViews, text: String) {
            ROWS.forEach { v.setViewVisibility(it[0], View.GONE) }
            v.setViewVisibility(R.id.empty, View.VISIBLE)
            v.setTextViewText(R.id.empty, text)
            v.setViewVisibility(R.id.notice, View.GONE)
        }

        private fun prefersWhite(c: Int): Boolean = 0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c) < 170

        private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        private fun openStop(context: Context, id: Int, stopId: String): PendingIntent {
            val i = Intent(Intent.ACTION_VIEW, Uri.parse("nswtransport://stop/" + Uri.encode(stopId))).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, 400_000 + id, i, flags())
        }

        private fun configIntent(context: Context, id: Int): PendingIntent {
            val i = Intent(context, BoardWidgetConfigActivity::class.java)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, 500_000 + id, i, flags())
        }

        fun refreshIntent(context: Context, id: Int, code: Int = 600_000 + id): PendingIntent {
            val i = Intent(context, BoardWidgetProvider::class.java).setAction(ACTION_REFRESH)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            return PendingIntent.getBroadcast(context, code, i, flags())
        }

        private fun schedule(context: Context, id: Int, at: Long) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.set(AlarmManager.RTC, at, refreshIntent(context, id, 700_000 + id))
        }
    }
}

/** Which stop (and mode) each departure board follows. */
object BoardPrefs {
    data class Cfg(val stop: TransitApi.Stop, val mode: String?)
    private fun prefs(c: Context) = c.getSharedPreferences("transport_boards", Context.MODE_PRIVATE)

    fun save(c: Context, id: Int, cfg: Cfg) {
        prefs(c).edit().putString("b$id.stop", cfg.stop.id).putString("b$id.name", cfg.stop.name).putString("b$id.mode", cfg.mode ?: "").apply()
    }

    fun load(c: Context, id: Int): Cfg? {
        val p = prefs(c)
        val s = p.getString("b$id.stop", null) ?: return null
        return Cfg(TransitApi.Stop(s, p.getString("b$id.name", "") ?: ""), p.getString("b$id.mode", "")?.takeIf { it.isNotEmpty() })
    }

    fun clear(c: Context, id: Int) {
        val e = prefs(c).edit()
        listOf("stop", "name", "mode").forEach { e.remove("b$id.$it") }
        e.apply()
    }
}
