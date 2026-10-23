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
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/** Shown when the widget is added or edited: Smart, a saved trip, or any two stops. */
class TripWidgetConfigActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private var from: TransitApi.Stop? = null
    private var to: TransitApi.Stop? = null
    private lateinit var list: LinearLayout
    private lateinit var saved: LinearLayout
    private lateinit var fromResults: LinearLayout
    private lateinit var toResults: LinearLayout
    private lateinit var addButton: Button
    private val main = Handler(Looper.getMainLooper())

    private val dark get() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private val bg get() = if (dark) Color.parseColor("#000000") else Color.parseColor("#F2F2F7")
    private val card get() = if (dark) Color.parseColor("#1C1C1E") else Color.WHITE
    private val textColor get() = if (dark) Color.WHITE else Color.BLACK
    private val secondary get() = if (dark) Color.parseColor("#AEAEB2") else Color.parseColor("#6C6C70")
    private val accent = Color.parseColor("#0A84FF")

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        window.statusBarColor = bg
        window.navigationBarColor = bg

        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(28), dp(20), dp(32)) }
        val scroll = ScrollView(this).apply { setBackgroundColor(bg); addView(list); fitsSystemWindows = true }
        setContentView(scroll)

        list.addView(label("Choose a trip", 28f, textColor, bold = true))
        list.addView(label("The widget shows the next services with a live countdown.", 15f, secondary).apply { setPadding(0, dp(4), 0, dp(16)) })

        list.addView(row("Smart", "Home to Work in the morning, back in the evening") { finishWith(null) })

        list.addView(section("Saved trips"))
        saved = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        saved.addView(label("Loading", 14f, secondary))
        list.addView(saved)

        list.addView(section("Or pick two stops"))
        val fromField = field("From: stop or station")
        fromResults = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val toField = field("To: stop or station")
        toResults = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        list.addView(fromField); list.addView(fromResults)
        list.addView(toField); list.addView(toResults)
        watch(fromField, fromResults) { s -> from = s; fromField.setText(TransitApi.shortName(s.name)); fromResults.removeAllViews(); update() }
        watch(toField, toResults) { s -> to = s; toField.setText(TransitApi.shortName(s.name)); toResults.removeAllViews(); update() }

        addButton = Button(this).apply {
            text = "Add widget"
            isAllCaps = false
            setTextColor(Color.WHITE)
            textSize = 17f
            background = rounded(accent, 14)
            isEnabled = false
            alpha = 0.4f
            setOnClickListener {
                val f = from; val t = to
                if (f != null && t != null) finishWith(TransitApi.Choice(TransitApi.shortName(f.name), f, t))
            }
        }
        list.addView(addButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(16) })

        thread {
            val choices = try { TransitApi.choices() } catch (e: Exception) { emptyList() }
            main.post {
                saved.removeAllViews()
                if (choices.isEmpty()) saved.addView(label("No saved trips yet. Pick two stops below.", 14f, secondary))
                choices.forEach { c ->
                    saved.addView(row(c.title, "${TransitApi.shortName(c.from.name)} to ${TransitApi.shortName(c.to.name)}") { finishWith(c) })
                }
            }
        }
    }

    private fun update() {
        val ok = from != null && to != null
        addButton.isEnabled = ok
        addButton.alpha = if (ok) 1f else 0.4f
    }

    private fun finishWith(choice: TransitApi.Choice?) {
        WidgetPrefs.save(this, widgetId, choice)
        val ctx = applicationContext
        val id = widgetId
        thread { TripWidgetProvider.update(ctx, AppWidgetManager.getInstance(ctx), id) }
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }

    private fun watch(field: EditText, results: LinearLayout, pick: (TransitApi.Stop) -> Unit) {
        var pending: Runnable? = null
        var picking = false
        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (picking) return
                pending?.let { main.removeCallbacks(it) }
                val q = s?.toString()?.trim() ?: ""
                if (q.length < 2) { results.removeAllViews(); return }
                val r = Runnable {
                    thread {
                        val stops = try { TransitApi.search(q) } catch (e: Exception) { emptyList() }
                        main.post {
                            results.removeAllViews()
                            stops.forEach { st ->
                                results.addView(row(TransitApi.shortName(st.name), st.name.substringAfter(",", "").trim()) {
                                    picking = true; pick(st); picking = false
                                })
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
