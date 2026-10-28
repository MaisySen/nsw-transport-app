// Checks plugins/widget/kotlin/WidgetLive.kt on its own (plain Kotlin, no Android). app/test/widgetlive.test.mjs
// compiles it with that file when kotlinc is on the machine, runs it and compares every line with the app's
// liveState (src/lib/liveLabelCore.ts) and with the iPhone widget's rule. One JSON object per line.
import com.maisysen.nswtransport.widget.WidgetLive

fun main() {
    val at = 1_793_268_000_000L
    for (age in longArrayOf(0, 60, 119, 120, 121, 180, 299, 300, 301, 600, 1200)) {
        for (lead in longArrayOf(30, 300, 599, 600, 601, 900, 1800)) {
            val fresh = WidgetLive.isFresh(at - age * 1000, at + lead * 1000, at)
            println("{\"age\":$age,\"fresh\":$fresh,\"kind\":\"fresh\",\"lead\":$lead}")
        }
    }
    fun d(feed: Long, server: Long) = (WidgetLive.dataAt(at, feed, server) - at) / 1000
    println("{\"case\":\"none\",\"kind\":\"dataAt\",\"v\":${d(0, 0)}}")
    println("{\"case\":\"feed90\",\"kind\":\"dataAt\",\"v\":${d(at - 90_000, 0)}}")
    println("{\"case\":\"skew\",\"kind\":\"dataAt\",\"v\":${d(at + 600_000 - 40_000, at + 600_000)}}")
    println("{\"case\":\"future\",\"kind\":\"dataAt\",\"v\":${d(at + 60_000, at)}}")
    println("{\"case\":\"ancient\",\"kind\":\"dataAt\",\"v\":${d(1000, at)}}")
    println("{\"case\":\"zero\",\"kind\":\"dataAt\",\"v\":${d(0, at)}}")
    // The refresh alarm cap: the first moment isFresh turns false, for a grid of data ages and leads.
    for (age in longArrayOf(0, 60, 200)) {
        for (lead in longArrayOf(30, 300, 700, 900, 1800)) {
            val dataAt = at - age * 1000
            val leave = at + lead * 1000
            val s = WidgetLive.staleAt(dataAt, leave)
            val ok = (s <= at || WidgetLive.isFresh(dataAt, leave, s - 1)) && !WidgetLive.isFresh(dataAt, leave, s)
            println("{\"age\":$age,\"kind\":\"staleAt\",\"lead\":$lead,\"ok\":$ok}")
        }
    }
    println("{\"kind\":\"timetable\",\"v\":${(WidgetLive.timetable(at + 900_000, at + 1_020_000, at + 840_000) - at) / 1000}}")
    println("{\"kind\":\"timetable\",\"v\":${WidgetLive.timetable(at + 900_000, 0, at)}}")
}
