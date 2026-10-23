package com.maisysen.nswtransport.widget

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/** Reads live trips from the Transport backend. Runs off the main thread. */
object TransitApi {
    const val BASE = "https://nsw-transport-bot.sites.tab.bot"
    const val PROFILE = "bidur"
    val SYDNEY: TimeZone = TimeZone.getTimeZone("Australia/Sydney")

    data class Stop(val id: String, val name: String)
    data class Choice(val title: String, val from: Stop, val to: Stop)
    data class Trip(
        val line: String, val color: Int, val leave: Long, val board: Long, val live: Boolean,
        val status: String, val platform: String?, val changes: Int, val cancelled: Boolean
    )
    data class Result(val trips: List<Trip>, val notice: String?, val severe: Boolean, val fromName: String, val toName: String)

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun get(path: String): JSONObject {
        val c = URL(BASE + path).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 12000
        c.setRequestProperty("Accept", "application/json")
        try {
            val body = c.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(body)
        } finally {
            c.disconnect()
        }
    }

    fun parseTime(s: String?): Long {
        if (s.isNullOrEmpty() || s == "null") return 0
        for (p in arrayOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")) {
            try {
                val f = SimpleDateFormat(p, Locale.US)
                f.timeZone = TimeZone.getTimeZone("UTC")
                return f.parse(s)?.time ?: continue
            } catch (e: Exception) { }
        }
        return 0
    }

    fun clock(t: Long): String {
        val f = SimpleDateFormat("h:mm", Locale.US)
        f.timeZone = SYDNEY
        return f.format(t)
    }

    fun shortName(s: String): String = s.split(",")[0].trim().replace(" Station", "")

    private fun color(hex: String?, mode: String?): Int {
        val fallback = when (mode) {
            "train" -> "#F6891F"; "metro" -> "#168388"; "lightrail" -> "#E4022D"; "ferry" -> "#5AB031"; else -> "#00B5EF"
        }
        return try { Color.parseColor(if (hex.isNullOrEmpty() || hex == "null") fallback else hex) } catch (e: Exception) { Color.parseColor(fallback) }
    }

    private fun status(live: Boolean, delay: Int?, cancelled: Boolean): String = when {
        cancelled -> "Cancelled"
        !live -> "Scheduled"
        delay == null || delay == 0 -> "On time"
        delay > 0 -> "$delay min late"
        else -> "${-delay} min early"
    }

    fun trips(from: Stop, to: Stop): Result {
        val j = get("/api/trip?from=${enc(from.id)}&to=${enc(to.id)}&fromName=${enc(from.name)}&toName=${enc(to.name)}&count=6&profile=$PROFILE")
        val now = System.currentTimeMillis()
        val out = ArrayList<Trip>()
        var notice: String? = null
        var severe = false
        val js = j.optJSONArray("journeys") ?: JSONArray()
        for (i in 0 until js.length()) {
            val jo = js.getJSONObject(i)
            val leave = parseTime(jo.optString("leave"))
            if (leave < now - 30_000) continue
            val legs = jo.optJSONArray("legs") ?: continue
            var first: JSONObject? = null
            for (k in 0 until legs.length()) {
                val l = legs.getJSONObject(k)
                if (l.optString("kind") != "walk") { first = l; break }
            }
            val f = first ?: continue
            val live = jo.optBoolean("live", false)
            val cancelled = jo.optBoolean("anyCancelled", false)
            val delay = if (f.isNull("delayMin")) null else f.optInt("delayMin")
            val plat = f.optString("fromPlatform").takeIf { it.isNotEmpty() && it != "null" }
            out.add(Trip(f.optString("line"), color(f.optString("color"), f.optString("mode")), leave,
                parseTime(jo.optString("board")).takeIf { it > 0 } ?: leave, live, status(live, delay, cancelled),
                plat, jo.optInt("changes", 0), cancelled))
            if (out.size == 1) {
                val n = notice(jo, legs, f, delay)
                notice = n?.first; severe = n?.second ?: false
            }
        }
        val fn = j.optJSONObject("from")?.optString("name")?.takeIf { it.isNotEmpty() && !it.all { c -> c.isDigit() } } ?: from.name
        val tn = j.optJSONObject("to")?.optString("name")?.takeIf { it.isNotEmpty() && !it.all { c -> c.isDigit() } } ?: to.name
        return Result(out, notice, severe, shortName(fn), shortName(tn))
    }

    /** The one thing worth knowing before you leave, most serious first. */
    private fun notice(jo: JSONObject, legs: JSONArray, first: JSONObject, delay: Int?): Pair<String, Boolean>? {
        if (jo.optBoolean("anyCancelled", false)) return "Cancelled. Take the next one." to true
        val was = first.optString("platformChangedFrom")
        if (was.isNotEmpty() && was != "null") return "Now ${first.optString("fromPlatform")}, was $was" to false
        val words = listOf("buses replace", "trackwork", "not running", "changed timetable", "delays")
        var mild: String? = null
        for (k in 0 until legs.length()) {
            val alerts = legs.getJSONObject(k).optJSONArray("alerts") ?: continue
            for (a in 0 until alerts.length()) {
                val al = alerts.optJSONObject(a) ?: continue
                val title = al.optString("title")
                val p = al.optString("priority").lowercase(Locale.US)
                if (p == "high" || p == "veryhigh") return title to true
                if (mild == null && words.any { title.lowercase(Locale.US).contains(it) }) mild = title
            }
        }
        if (mild != null) return mild to false
        if (delay != null && delay >= 5) return "Running $delay min late" to false
        return null
    }

    fun search(q: String): List<Stop> {
        val j = get("/api/search?q=${enc(q)}&profile=$PROFILE")
        val a = j.optJSONArray("items") ?: return emptyList()
        return (0 until minOf(a.length(), 8)).map { val o = a.getJSONObject(it); Stop(o.optString("id"), o.optString("name")) }
    }

    private fun stop(o: JSONObject?): Stop? = o?.let { Stop(it.optString("id"), it.optString("name")) }

    fun choices(): List<Choice> {
        val out = ArrayList<Choice>()
        try {
            val c = get("/api/commutes?profile=$PROFILE").optJSONArray("items") ?: JSONArray()
            for (i in 0 until c.length()) {
                val o = c.getJSONObject(i)
                if (o.has("active") && !o.optBoolean("active", true)) continue
                val f = stop(o.optJSONObject("from")) ?: continue
                val t = stop(o.optJSONObject("to")) ?: continue
                out.add(Choice(o.optString("name").takeIf { it.isNotEmpty() && it != "null" } ?: "Commute", f, t))
            }
        } catch (e: Exception) { }
        try {
            val s = get("/api/saved?profile=$PROFILE").optJSONArray("items") ?: JSONArray()
            for (i in 0 until s.length()) {
                val o = s.getJSONObject(i)
                val f = stop(o.optJSONObject("from")) ?: continue
                val t = stop(o.optJSONObject("to")) ?: continue
                out.add(Choice(o.optString("name").replaceFirstChar { it.uppercase() }, f, t))
            }
        } catch (e: Exception) { }
        return out
    }

    /** Smart: the commute whose time is next (from 30 minutes ago), else Home or Work by time of day. */
    fun smart(): Choice? {
        val cal = Calendar.getInstance(SYDNEY)
        val minute = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        try {
            val c = get("/api/commutes?profile=$PROFILE").optJSONArray("items") ?: JSONArray()
            var best: Choice? = null
            var bestGap = Int.MAX_VALUE
            for (i in 0 until c.length()) {
                val o = c.getJSONObject(i)
                if (o.has("active") && !o.optBoolean("active", true)) continue
                val tod = o.optInt("tod", -1)
                if (tod < 0) continue
                val gap = ((tod - (minute - 30)) % 1440 + 1440) % 1440
                val f = stop(o.optJSONObject("from")) ?: continue
                val t = stop(o.optJSONObject("to")) ?: continue
                if (gap < bestGap) { bestGap = gap; best = Choice(o.optString("name").takeIf { it.isNotEmpty() && it != "null" } ?: "Commute", f, t) }
            }
            if (best != null) return best
        } catch (e: Exception) { }
        val saved = choices()
        if (saved.isEmpty()) return null
        val morning = minute < 12 * 60
        val work = saved.firstOrNull { it.title.lowercase(Locale.US).contains("work") }
        val home = saved.firstOrNull { it.title.lowercase(Locale.US).contains("home") }
        if (morning && work != null) return work.copy(title = "Work")
        if (!morning && home != null) return home.copy(title = "Home")
        val first = saved[0]
        if (!morning && saved.any { it.from.id == first.to.id && it.to.id == first.from.id }) return Choice("Return", first.to, first.from)
        return home ?: work ?: first
    }
}
