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
 * Resolves on first page-finished (after a short settle delay so script-rendered
 * content is present) or when the timeout elapses, whichever comes first. Never
 * throws: a failed load yields a [CapturedPage] with null fields so the caller can
 * degrade to a URL-only save. All methods must be called on the main thread (a
 * WebView requirement).
 */
@SuppressLint("SetJavaScriptEnabled")
class HtmlCaptor(context: Context) {
	val webView: WebView = WebView(context).apply {
		settings.javaScriptEnabled = true
		settings.domStorageEnabled = true
		settings.userAgentString = AppConfig.WEB_VIEW_USER_AGENT
	}

	suspend fun capture(url: String, timeoutMillis: Long = 12_000, settleMillis: Long = 400): CapturedPage =
		withTimeoutOrNull(timeoutMillis) {
			awaitPageFinished(url)
			delay(settleMillis)
			CapturedPage(
				rawHtml = evaluate("document.documentElement.outerHTML"),
				title = evaluate("document.title"),
			)
		} ?: CapturedPage(null, null)

	private suspend fun awaitPageFinished(url: String) = suspendCancellableCoroutine { continuation ->
		webView.webViewClient = object : WebViewClient() {
			override fun onPageFinished(view: WebView, finishedUrl: String) {
				if (continuation.isActive) continuation.resume(Unit)
			}

			override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
				if (request.isForMainFrame && continuation.isActive) continuation.resume(Unit)
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
