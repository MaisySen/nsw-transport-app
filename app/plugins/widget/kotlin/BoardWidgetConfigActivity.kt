package com.maisysen.nswtransport.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/** Shown when the departure board is added or edited: pick a stop, then all services or one mode. */
class BoardWidgetConfigActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private lateinit var list: LinearLayout
    private lateinit var results: LinearLayout
    private lateinit var modes: LinearLayout
    private val main = Handler(Looper.getMainLooper())

    private val dark get() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private val bg get() = if (dark) Color.parseColor("#000000") else Color.parseColor("#F2F2F7")
    private val card get() = if (dark) Color.parseColor("#1C1C1E") else Color.WHITE
    private val textColor get() = if (dark) Color.WHITE else Color.BLACK
    private val secondary get() = if (dark) Color.parseColor("#AEAEB2") else Color.parseColor("#6C6C70")
    private val accent = Color.parseColor("#0A84FF")

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    /** TfNSW product classes from stop search, as the modes the board can filter by. */
    private fun modeKeys(classes: List<String>): List<String> {
        val out = LinkedHashSet<String>()
        for (c in classes) when (c) {
            "1" -> out.add("train"); "2" -> out.add("metro"); "4" -> out.add("lightrail"); "5", "7", "11" -> out.add("bus"); "9" -> out.add("ferry")
        }
        return out.toList()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        TransitApi.init(this)
        setResult(RESULT_CANCELED)
        widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        window.statusBarColor = bg
        window.navigationBarColor = bg

        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(28), dp(20), dp(32)) }
        val scroll = ScrollView(this).apply { setBackgroundColor(bg); addView(list); fitsSystemWindows = true }
        setContentView(scroll)

        list.addView(label("Choose a stop", 28f, textColor, bold = true))
        list.addView(label("The board shows the next services from this stop with platforms and live times.", 15f, secondary).apply { setPadding(0, dp(4), 0, dp(8)) })

        modes = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        list.addView(modes)

        val mine = TransitApi.stops()
        if (mine.isNotEmpty()) {
            list.addView(section("Your stops"))
            mine.forEach { s -> list.addView(row(TransitApi.shortName(s.name), s.name.substringAfter(",", "").trim()) { pickStop(s, null) }) }
        }

        list.addView(section("Search"))
        val field = field("Stop, station or wharf")
        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        list.addView(field)
        list.addView(results)
        watch(field)
    }

    /** With more than one mode at the stop, ask which; otherwise add the board straight away. */
    private fun pickStop(s: TransitApi.Stop, classes: List<String>?) {
        if (classes == null) {
            thread {
                val found = try { TransitApi.searchModes(TransitApi.shortName(s.name)).firstOrNull { it.first.id == s.id }?.second } catch (e: Exception) { null }
                main.post { pickStop(s, found ?: emptyList()) }
            }
            return
        }
        val keys = modeKeys(classes)
        if (keys.size <= 1) { finishWith(BoardPrefs.Cfg(s, null)); return }
        modes.removeAllViews()
        modes.visibility = View.VISIBLE
        modes.addView(section(TransitApi.shortName(s.name)))
        modes.addView(row("All services", "Everything leaving this stop") { finishWith(BoardPrefs.Cfg(s, null)) })
        keys.forEach { k -> modes.addView(row(BoardWidgetProvider.modeLabel(k), "Only ${BoardWidgetProvider.modeLabel(k).lowercase()}") { finishWith(BoardPrefs.Cfg(s, k)) }) }
        (list.parent as? ScrollView)?.smoothScrollTo(0, 0)
    }

    private fun finishWith(cfg: BoardPrefs.Cfg) {
        BoardPrefs.save(this, widgetId, cfg)
        val ctx = applicationContext
        val id = widgetId
        thread { BoardWidgetProvider.update(ctx, AppWidgetManager.getInstance(ctx), id) }
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }

    private fun watch(field: EditText) {
        var pending: Runnable? = null
        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                pending?.let { main.removeCallbacks(it) }
                val q = s?.toString()?.trim() ?: ""
                if (q.length < 2) { results.removeAllViews(); return }
                val r = Runnable {
                    thread {
                        val stops = try { TransitApi.searchModes(q) } catch (e: Exception) { emptyList() }
                        main.post {
                            results.removeAllViews()
                            if (stops.isEmpty()) results.addView(label("No stops found.", 14f, secondary).apply { setPadding(dp(4), dp(8), 0, 0) })
                            stops.forEach { (st, cls) ->
                                results.addView(row(TransitApi.shortName(st.name), st.name.substringAfter(",", "").trim()) { pickStop(st, cls) })
                            }
                        }
                    }
                }
                pending = r
                main.postDelayed(r, 300)
            }
        })
    }

    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }

    private fun label(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }

    private fun section(s: String) = label(s.uppercase(), 13f, secondary).apply { setPadding(dp(16), dp(22), 0, dp(8)) }

    private fun field(hint: String) = EditText(this).apply {
        this.hint = hint
        setHintTextColor(secondary)
        setTextColor(textColor)
        textSize = 17f
        isSingleLine = true
        background = rounded(card, 12)
        setPadding(dp(16), dp(14), dp(16), dp(14))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
    }

    private fun row(title: String, subtitle: String, onTap: () -> Unit): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(card, 12)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            isClickable = true
            setOnClickListener { onTap() }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) }
            gravity = Gravity.CENTER_VERTICAL
        }
        box.addView(label(title, 17f, textColor))
        if (subtitle.isNotEmpty()) box.addView(label(subtitle, 13f, secondary))
        return box
    }
}
