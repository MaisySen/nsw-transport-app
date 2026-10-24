package com.maisysen.nswtransport.widget

import android.content.Context
import android.database.sqlite.SQLiteDatabase
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
    /** This install's server profile, written by the app on first launch (see src/lib/device.ts). */
    @Volatile private var PROFILE = "none"

    /** The app's own state (trips saved on this phone, their order, home and work, starred stops). */
    @Volatile var STORE: JSONObject = JSONObject()
        private set

    /** Reads the app's "profile" and "store" keys from its key value storage. Until the app has been opened once, no saved trips show. */
    fun init(context: Context) {
        try {
            val path = context.getDatabasePath("RKStorage")
            if (!path.exists()) return
            SQLiteDatabase.openDatabase(path.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
                db.rawQuery("SELECT key, value FROM catalystLocalStorage WHERE key IN ('profile', 'store')", null).use { c ->
                    while (c.moveToNext()) {
                        val k = c.getString(0)
                        val v = c.getString(1)
                        if (v.isNullOrBlank()) continue
                        if (k == "profile") PROFILE = enc(v)
                        else if (k == "store") STORE = try { JSONObject(v) } catch (e: Exception) { JSONObject() }
                    }
                }
            }
        } catch (e: Exception) { }
    }
    val SYDNEY: TimeZone = TimeZone.getTimeZone("Australia/Sydney")

    data class Stop(val id: String, val name: String)
    /** A trip to follow. A multi leg trip carries its legs in the /api/plan form: [{f, fn, t, tn, m, c, a, w}]. */
    data class Choice(val title: String, val from: Stop, val to: Stop, val legs: String? = null) {
        val multi get() = legs != null
        /** The change stops, in order. */
        fun vias(): List<String> {
            val a = try { JSONArray(legs ?: return emptyList()) } catch (e: Exception) { return emptyList() }
            return (0 until a.length() - 1).map { shortName(a.getJSONObject(it).optString("tn")) }
        }
        /** One key per trip, the same as the app's (from > change stops > to). */
        val key: String get() {
            val a = try { legs?.let { JSONArray(it) } } catch (e: Exception) { null } ?: return "${from.id}>${to.id}"
            return (listOf(from.id) + (0 until a.length() - 1).map { a.getJSONObject(it).optString("t") } + listOf(to.id)).joinToString(">")
        }
    }
    /** One service on a leg: line badge text and colour. */
    data class Line(val name: String, val color: Int)
    data class Trip(
        val line: String, val color: Int, val leave: Long, val board: Long, val live: Boolean,
        val status: String, val platform: String?, val changes: Int, val cancelled: Boolean,
        val arrive: Long = 0, val minutes: Int = 0, val lines: List<Line> = emptyList(),
        val warn: String? = null, val risk: String = "ok"
    )
    data class Result(val trips: List<Trip>, val notice: String?, val severe: Boolean, val fromName: String, val toName: String)
    /** One row of a departure board. */
    data class Departure(
        val line: String, val color: Int, val dest: String, val platform: String?, val time: Long,
        val live: Boolean, val delay: Int?, val cancelled: Boolean, val mode: String
    )
    data class Board(val stopName: String, val items: List<Departure>, val notice: String?)

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

    /** Live trips for a choice: multi leg trips are planned leg by leg on the server. */
    fun trips(choice: Choice): Result = if (choice.legs != null) chain(choice) else trips(choice.from, choice.to)

    private fun chain(choice: Choice): Result {
        val j = get("/api/plan?legs=${enc(choice.legs ?: "[]")}&count=6&profile=$PROFILE")
        val now = System.currentTimeMillis()
        val out = ArrayList<Trip>()
        val js = j.optJSONArray("journeys") ?: JSONArray()
        var notice: String? = null
        var severe = false
        for (i in 0 until js.length()) {
            val jo = js.getJSONObject(i)
            val leave = parseTime(jo.optString("leave"))
            if (leave < now - 30_000) continue
            if (jo.optBoolean("beaten", false) && out.isNotEmpty()) continue
            val legs = jo.optJSONArray("legs") ?: continue
            val lines = ArrayList<Line>()
            var first: JSONObject? = null
            for (k in 0 until legs.length()) {
                val l = legs.getJSONObject(k)
                if (l.optString("kind") != "transit") continue
                if (first == null) first = l
                lines.add(Line(l.optString("line").ifEmpty { l.optString("modeName") }, color(l.optString("color"), l.optString("mode"))))
            }
            val f = first ?: continue
            val live = jo.optBoolean("live", false)
            val cancelled = jo.optBoolean("anyCancelled", false)
            val delay = if (f.isNull("delayMin")) null else f.optInt("delayMin")
            val warn = jo.optString("warn").takeIf { it.isNotEmpty() && it != "null" }
            val plat = f.optString("fromPlatform").takeIf { it.isNotEmpty() && it != "null" }
            out.add(Trip(f.optString("line"), color(f.optString("color"), f.optString("mode")), leave,
                parseTime(jo.optString("board")).takeIf { it > 0 } ?: leave, live, status(live, delay, cancelled),
                plat, jo.optInt("changes", 0), cancelled, parseTime(jo.optString("arrive")), jo.optInt("durationMin", 0),
                lines, warn, jo.optString("risk", "ok")))
            if (out.size == 1) {
                val n = notice(jo, legs, f, delay)
                if (warn != null) { notice = warn; severe = jo.optString("risk") == "miss" || cancelled }
                else { notice = n?.first; severe = n?.second ?: false }
            }
        }
        return Result(out, notice, severe, shortName(choice.from.name), shortName(choice.to.name))
    }

    /** The next services from a stop, optionally one mode only. */
    fun board(stopId: String, mode: String?, max: Int = 6): Board {
        val j = get("/api/departures?stop=${enc(stopId)}" + (if (mode.isNullOrEmpty()) "" else "&mode=${enc(mode)}") + "&profile=$PROFILE")
        val now = System.currentTimeMillis()
        val a = j.optJSONArray("items") ?: JSONArray()
        val out = ArrayList<Departure>()
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i)
            if (!mode.isNullOrEmpty() && o.optString("mode") != mode) continue
            val live = o.optBoolean("realtime", false)
            val t = parseTime(if (live) o.optString("estimated") else null).takeIf { it > 0 } ?: parseTime(o.optString("planned"))
            if (t < now - 30_000) continue
            out.add(Departure(o.optString("line").ifEmpty { o.optString("modeName") }, color(o.optString("color"), o.optString("mode")),
                shortName(o.optString("dest")).ifEmpty { o.optString("description") },
                o.optString("platform").takeIf { it.isNotEmpty() && it != "null" }, t, live,
                if (o.isNull("delayMin")) null else o.optInt("delayMin"), o.optBoolean("cancelled", false), o.optString("mode")))
            if (out.size >= max) break
        }
        val stop = j.optJSONObject("stop")
        var notice: String? = null
        val al = j.optJSONArray("alerts")
        if (al != null) for (i in 0 until al.length()) {
            val x = al.optJSONObject(i) ?: continue
            val p = x.optString("priority").lowercase(Locale.US)
            if (p == "high" || p == "veryhigh") { notice = x.optString("title"); break }
        }
        return Board(shortName(stop?.optString("name") ?: ""), out, notice)
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

    fun search(q: String): List<Stop> = searchModes(q).map { it.first }

    /** Stops matching a name, each with the modes that stop there. */
    fun searchModes(q: String): List<Pair<Stop, List<String>>> {
        val j = get("/api/search?q=${enc(q)}&profile=$PROFILE")
        val a = j.optJSONArray("items") ?: return emptyList()
        return (0 until minOf(a.length(), 8)).map {
            val o = a.getJSONObject(it)
            val m = o.optJSONArray("modes") ?: JSONArray()
            Stop(o.optString("id"), o.optString("name")) to (0 until m.length()).map { k -> m.optString(k) }
        }
    }

    private fun stop(o: JSONObject?): Stop? = o?.let { s -> Stop(s.optString("id"), s.optString("name")).takeIf { it.id.isNotEmpty() && it.id != "null" } }

    /** A trip saved on this phone (app form: from, to, legs or via) as a choice with /api/plan legs when it has more than one leg. */
    private fun localChoice(o: JSONObject): Choice? {
        val from = stop(o.optJSONObject("from")) ?: return null
        val to = stop(o.optJSONObject("to")) ?: return null
        val name = o.optString("name").takeIf { it.isNotEmpty() && it != "null" } ?: "${shortName(from.name)} to ${shortName(to.name)}"
        val modes = o.optJSONArray("modes")
        val legs = o.optJSONArray("legs")?.takeIf { it.length() > 1 }
            ?: o.optJSONObject("via")?.let { v ->
                JSONArray().put(JSONObject().put("mode", modes?.optString(0) ?: "").put("from", o.getJSONObject("from")).put("to", v))
                    .put(JSONObject().put("mode", modes?.optString(1) ?: "").put("from", v).put("to", o.getJSONObject("to")).put("conn", o.optInt("conn", 5)))
            }
        if (legs == null) return Choice(name, from, to)
        val wire = JSONArray()
        for (k in 0 until legs.length()) {
            val l = legs.getJSONObject(k)
            val f = l.optJSONObject("from") ?: return Choice(name, from, to)
            val t = l.optJSONObject("to") ?: return Choice(name, from, to)
            wire.put(JSONObject().put("f", f.optString("id")).put("fn", f.optString("name")).put("t", t.optString("id")).put("tn", t.optString("name"))
                .put("m", l.optString("mode", "")).put("c", if (l.has("conn")) l.optInt("conn", 5) else 5)
                .put("a", if (l.optBoolean("any", false)) 1 else 0).put("w", if (l.has("walk")) l.optInt("walk", 5) else 5))
        }
        return Choice(name, from, to, wire.toString())
    }

    /** /api/plan legs in the app's trip screen form, for opening a multi leg trip. */
    fun appLegs(wire: String): String {
        val a = try { JSONArray(wire) } catch (e: Exception) { return "[]" }
        val out = JSONArray()
        for (k in 0 until a.length()) {
            val l = a.getJSONObject(k)
            val o = JSONObject().put("mode", l.optString("m", "")).put("from", JSONObject().put("id", l.optString("f")).put("name", l.optString("fn")))
                .put("to", JSONObject().put("id", l.optString("t")).put("name", l.optString("tn")))
            if (k > 0) o.put("conn", l.optInt("c", 5))
            if (l.optInt("a", 0) == 1) o.put("any", true)
            if (l.optString("m") == "walk") o.put("walk", l.optInt("w", 5))
            out.put(o)
        }
        return out.toString()
    }

    /** Home and work stops set in the app. */
    fun place(kind: String): Stop? = stop(STORE.optJSONObject("places")?.optJSONObject(kind))

    /** Starred stops, then recently opened ones. */
    fun stops(): List<Stop> {
        val out = ArrayList<Stop>()
        for (k in listOf("starred", "recents")) {
            val a = STORE.optJSONArray(k) ?: continue
            for (i in 0 until a.length()) { val s = stop(a.optJSONObject(i)) ?: continue; if (out.none { it.id == s.id }) out.add(s) }
        }
        return out.take(8)
    }

    /**
     * Every trip, in the order Home shows them: commutes, trips saved on this phone, trips saved on the server,
     * then sorted by the order you dragged them into.
     */
    fun choices(includeCommutes: Boolean = true): List<Choice> {
        val out = ArrayList<Choice>()
        fun add(c: Choice) { if (out.none { it.key == c.key }) out.add(c) }
        if (includeCommutes) try {
            val c = get("/api/commutes?profile=$PROFILE").optJSONArray("items") ?: JSONArray()
            for (i in 0 until c.length()) {
                val o = c.getJSONObject(i)
                if (o.has("active") && !o.optBoolean("active", true)) continue
                val f = stop(o.optJSONObject("from")) ?: continue
                val t = stop(o.optJSONObject("to")) ?: continue
                add(Choice(o.optString("name").takeIf { it.isNotEmpty() && it != "null" } ?: "Commute", f, t))
            }
        } catch (e: Exception) { }
        val mine = STORE.optJSONArray("myTrips") ?: JSONArray()
        for (i in 0 until mine.length()) localChoice(mine.optJSONObject(i) ?: continue)?.let { add(it) }
        try {
            val s = get("/api/saved?profile=$PROFILE").optJSONArray("items") ?: JSONArray()
            for (i in 0 until s.length()) {
                val o = s.getJSONObject(i)
                val f = stop(o.optJSONObject("from")) ?: continue
                val t = stop(o.optJSONObject("to")) ?: continue
                val legs = o.optJSONArray("legs")?.takeIf { it.length() > 1 }?.toString()
                add(Choice(o.optString("name").replaceFirstChar { it.uppercase() }, f, t, legs))
            }
        } catch (e: Exception) { }
        val order = STORE.optJSONArray("tripOrder")
        if (order == null || order.length() == 0) return out
        val pos = (0 until order.length()).associate { order.optString(it) to it }
        return out.withIndex().sortedWith(compareBy({ pos[it.value.key] ?: (1000 + it.index) }, { it.index })).map { it.value }
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
        val morning = minute < 12 * 60
        val home = place("home")
        val workStop = place("work")
        if (home != null && workStop != null && home.id != workStop.id)
            return if (morning) Choice("Work", home, workStop) else Choice("Home", workStop, home)
        val saved = choices(includeCommutes = false)
        if (saved.isEmpty()) return null
        val work = saved.firstOrNull { it.title.lowercase(Locale.US).contains("work") }
        val homeTrip = saved.firstOrNull { it.title.lowercase(Locale.US).contains("home") }
        if (morning && work != null) return work.copy(title = "Work")
        if (!morning && homeTrip != null) return homeTrip.copy(title = "Home")
        val first = saved[0]
        if (!morning && first.legs == null && saved.any { it.from.id == first.to.id && it.to.id == first.from.id }) return Choice("Return", first.to, first.from)
        return homeTrip ?: work ?: first
    }
}
