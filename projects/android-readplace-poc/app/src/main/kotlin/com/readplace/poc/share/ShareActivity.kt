package com.readplace.poc.share

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.readplace.poc.AppGraph
import com.readplace.poc.core.AppConfig
import com.readplace.poc.core.ApiException
import com.readplace.poc.platform.HtmlCaptor
import com.readplace.poc.platform.ShareIntel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The share-sheet entry point — the Android analogue of the iOS `ShareViewController`.
 * It renders the shared page in a hidden WebView, captures its HTML, and saves it via
 * the `save-html` action, degrading to a URL-only save if the user isn't signed in,
 * capture fails, or the HTML exceeds the server's limit. A small status card floats
 * over the sharing app, then auto-dismisses.
 */
class ShareActivity : ComponentActivity() {
	private lateinit var root: FrameLayout
	private lateinit var spinner: ProgressBar
	private lateinit var statusLabel: TextView
	private lateinit var graph: AppGraph
	private var captor: HtmlCaptor? = null

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		graph = AppGraph(this)
		setContentView(buildUi())
		lifecycleScope.launch { run() }
	}

	private suspend fun run() {
		if (!graph.tokenStore.isLoggedIn) {
			return finishWith("Open Readplace and sign in first.", success = false)
		}
		val shared = ShareIntel.extract(intent)
			?: return finishWith("No link found to save.", success = false)

		setStatus("Rendering page…")
		val captor = HtmlCaptor(this).also { this.captor = it }
		attachHidden(captor.webView)
		val captured = captor.capture(shared.url)
		val title = captured.title?.takeIf { it.isNotEmpty() } ?: shared.title

		setStatus("Saving…")
		try {
			val api = graph.api()
			val page = withContext(Dispatchers.IO) { api.loadQueue() }
			val html = captured.rawHtml
			val withinLimit = html != null && html.toByteArray(Charsets.UTF_8).size <= AppConfig.MAX_RAW_HTML_BYTES

			when {
				html != null && withinLimit && page.saveHtmlAction != null -> {
					val action = page.saveHtmlAction
					withContext(Dispatchers.IO) { api.saveHtml(action, shared.url, html, title) }
					finishWith("Saved with content", success = true)
				}
				page.saveArticleAction != null -> {
					val action = page.saveArticleAction
					withContext(Dispatchers.IO) { api.saveArticle(action, shared.url) }
					finishWith("Saved (link only)", success = true)
				}
				else -> finishWith("The server offered no save action.", success = false)
			}
		} catch (error: ApiException) {
			finishWith(error.error.message, success = false)
		} catch (error: Exception) {
			finishWith(error.message ?: "Save failed.", success = false)
		}
	}

	// MARK: - UI

	private fun buildUi(): ViewGroup {
		root = FrameLayout(this)

		val card = LinearLayout(this).apply {
			orientation = LinearLayout.VERTICAL
			gravity = Gravity.CENTER
			setPadding(dp(28), dp(28), dp(28), dp(28))
			background = GradientDrawable().apply {
				cornerRadius = dp(16).toFloat()
				setColor(Color.WHITE)
			}
		}

		spinner = ProgressBar(this)
		statusLabel = TextView(this).apply {
			text = "Preparing…"
			textSize = 16f
			setTextColor(Color.parseColor("#1A202C"))
			gravity = Gravity.CENTER
			setPadding(0, dp(16), 0, 0)
		}

		card.addView(spinner)
		card.addView(statusLabel)
		root.addView(
			card,
			FrameLayout.LayoutParams(dp(260), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER),
		)
		return root
	}

	/** The capture WebView must be in the hierarchy to lay out and run JS, but stays invisible behind the card. */
	private fun attachHidden(webView: android.view.View) {
		webView.alpha = 0f
		webView.isEnabled = false
		root.addView(webView, 0, FrameLayout.LayoutParams(MATCH, MATCH))
	}

	private fun setStatus(text: String) {
		spinner.visibility = android.view.View.VISIBLE
		statusLabel.text = text
	}

	private fun finishWith(message: String, success: Boolean) {
		spinner.visibility = android.view.View.GONE
		statusLabel.text = (if (success) "✓  " else "⚠  ") + message
		statusLabel.setTextColor(if (success) Color.parseColor("#3D8B6E") else Color.parseColor("#C8702A"))
		lifecycleScope.launch {
			delay(1400)
			finishAndRemoveTask()
		}
	}

	private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

	private companion object {
		const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
	}
}
