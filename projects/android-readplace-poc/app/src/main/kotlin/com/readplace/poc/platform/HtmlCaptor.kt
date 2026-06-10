package com.readplace.poc.platform

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.readplace.poc.core.AppConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONException
import org.json.JSONTokener
import kotlin.coroutines.resume

/** The rendered page content captured from a WebView. */
data class CapturedPage(val rawHtml: String?, val title: String?)

/**
 * Loads a URL in a WebView and returns the rendered DOM as
 * `document.documentElement.outerHTML` plus `document.title` — the same content the
 * browser extension and the iOS POC capture and send to `save-html`.
 *
 * Mirrors the iOS captor's resolution rules: extract after the first page-finished
 * (plus a short settle delay so script-rendered content is present), and on timeout
 * still extract whatever has rendered so far. A main-frame load failure yields null
 * fields instead — unlike iOS, Android's WebView renders its own error page into
 * the DOM, and extracting it would upload that error page as article content.
 * Never throws; the caller degrades to a URL-only save on null. All methods must
 * be called on the main thread (a WebView requirement).
 */
@SuppressLint("SetJavaScriptEnabled")
class HtmlCaptor(context: Context) {
	val webView: WebView = WebView(context).apply {
		settings.javaScriptEnabled = true
		settings.domStorageEnabled = true
		settings.userAgentString = AppConfig.WEB_VIEW_USER_AGENT
	}

	suspend fun capture(url: String, timeoutMillis: Long = 12_000, settleMillis: Long = 400): CapturedPage {
		val mainFrameLoaded = withTimeoutOrNull(timeoutMillis) {
			val loaded = awaitPageFinished(url)
			if (loaded) delay(settleMillis)
			loaded
		}
		if (mainFrameLoaded == false) {
			webView.stopLoading()
			return CapturedPage(rawHtml = null, title = null)
		}
		if (mainFrameLoaded == null) webView.stopLoading()
		val page = CapturedPage(
			rawHtml = evaluate("document.documentElement.outerHTML"),
			title = evaluate("document.title"),
		)
		webView.stopLoading()
		return page
	}

	/** Resumes true when the main frame finished, false when it failed to load. */
	private suspend fun awaitPageFinished(url: String): Boolean = suspendCancellableCoroutine { continuation ->
		webView.webViewClient = object : WebViewClient() {
			override fun onPageFinished(view: WebView, finishedUrl: String) {
				if (continuation.isActive) continuation.resume(true)
			}

			override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
				if (request.isForMainFrame && continuation.isActive) continuation.resume(false)
			}
		}
		webView.loadUrl(url)
	}

	private suspend fun evaluate(js: String): String? = suspendCancellableCoroutine { continuation ->
		webView.evaluateJavascript(js) { raw -> continuation.resume(decodeJsString(raw)) }
	}

	/** `evaluateJavascript` returns a JSON-encoded value; unwrap a JSON string, else null. */
	private fun decodeJsString(raw: String?): String? {
		if (raw == null || raw == "null") return null
		return try {
			JSONTokener(raw).nextValue() as? String
		} catch (_: JSONException) {
			null
		}
	}
}
