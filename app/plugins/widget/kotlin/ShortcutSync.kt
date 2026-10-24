package com.maisysen.nswtransport.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import com.maisysen.nswtransport.R
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Long press app icon shortcuts: Home, Work, Ask and the top 2 trips in your Home order.
 * Rebuilt when the app opens and when you leave it, so new or reordered trips show up.
 * Also refreshes the home screen widgets when you leave the app.
 */
object ShortcutSync {
    @Volatile private var lastSync = 0L
    @Volatile private var lastWidgets = 0L

    fun sync(context: Context) {
        val now = System.currentTimeMillis()
        if (now - lastSync < 20_000) return
        lastSync = now
        val ctx = context.applicationContext
        thread { try { build(ctx) } catch (e: Exception) { } }
    }

    /** Leaving the app: the trips may have changed, so rebuild shortcuts and redraw widgets (at most once a minute). */
    fun onLeave(context: Context) {
        val ctx = context.applicationContext
        val now = System.currentTimeMillis()
        thread {
            try {
                Thread.sleep(1500) // let the app finish writing its storage
                lastSync = System.currentTimeMillis()
                build(ctx)
                if (now - lastWidgets > 60_000) {
                    lastWidgets = now
                    refreshWidgets(ctx)
                }
            } catch (e: Exception) { }
        }
    }

    private fun refreshWidgets(ctx: Context) {
        val m = AppWidgetManager.getInstance(ctx)
        if (m.getAppWidgetIds(ComponentName(ctx, TripWidgetProvider::class.java)).isNotEmpty())
            ctx.sendBroadcast(Intent(ctx, TripWidgetProvider::class.java).setAction(TripWidgetProvider.ACTION_REFRESH))
        if (m.getAppWidgetIds(ComponentName(ctx, BoardWidgetProvider::class.java)).isNotEmpty())
            ctx.sendBroadcast(Intent(ctx, BoardWidgetProvider::class.java).setAction(BoardWidgetProvider.ACTION_REFRESH))
    }

    private fun view(ctx: Context, uri: Uri) = Intent(Intent.ACTION_VIEW, uri).setPackage(ctx.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    private fun via(c: TransitApi.Choice): String {
        val v = c.vias()
        return "${TransitApi.shortName(c.from.name)} to ${TransitApi.shortName(c.to.name)}" + if (v.isEmpty()) "" else " via ${v.joinToString(", ")}"
    }

    private fun short(s: String, n: Int) = if (s.length <= n) s else s.take(n - 1).trimEnd() + "\u2026"

    private fun build(ctx: Context) {
        if (Build.VERSION.SDK_INT < 25) return
        val sm = ctx.getSystemService(ShortcutManager::class.java) ?: return
        TransitApi.init(ctx)
        val trips = try { TransitApi.choices() } catch (e: Exception) { emptyList() }
        val homeStop = TransitApi.place("home")
        val workStop = TransitApi.place("work")
        val both = homeStop != null && workStop != null && homeStop.id != workStop.id
        val home = if (both) TransitApi.Choice("Home", workStop!!, homeStop!!) else trips.firstOrNull { it.title.lowercase(Locale.US).contains("home") }
        val work = if (both) TransitApi.Choice("Work", homeStop!!, workStop!!) else trips.firstOrNull { it.title.lowercase(Locale.US).contains("work") }
        val used = setOfNotNull(home?.key, work?.key)
        val top = trips.filter { it.key !in used }.take(2)

        val out = ArrayList<ShortcutInfo>()
        var rank = 0
        fun trip(id: String, c: TransitApi.Choice, label: String, icon: Int) {
            out.add(ShortcutInfo.Builder(ctx, id)
                .setShortLabel(short(label, 10))
                .setLongLabel(short(if (label == c.title) via(c) else "$label: ${via(c)}", 25))
                .setIcon(Icon.createWithResource(ctx, icon))
                .setIntent(view(ctx, TripWidgetProvider.tripUri(c)))
                .setRank(rank++)
                .build())
        }
        home?.let { trip("home", it, "Home", R.drawable.shortcut_home) }
        work?.let { trip("work", it, "Work", R.drawable.shortcut_work) }
        out.add(ShortcutInfo.Builder(ctx, "ask")
            .setShortLabel(ctx.getString(R.string.shortcut_ask_short))
            .setLongLabel(ctx.getString(R.string.shortcut_ask_long))
            .setIcon(Icon.createWithResource(ctx, R.drawable.shortcut_ask))
            .setIntent(view(ctx, Uri.parse("nswtransport://ask")))
            .setRank(rank++)
            .build())
        top.forEachIndexed { i, c -> trip("trip$i", c, c.title, R.drawable.shortcut_trip) }
        val max = try { sm.maxShortcutCountPerActivity } catch (e: Exception) { 5 }
        sm.dynamicShortcuts = out.take(max)
    }
}
