package com.readplace.android.app

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.readplace.android.core.AppConfig
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray

/**
 * Renders a page in an off-screen WebView and hands back its DOM. The main frame's
 * media type decides what happens through the tested [CaptureDecision]: a PDF is
 * never rendered — the WebView cannot, and reports it as a download, which is the
 * one signal Android gives for the main frame's type — while HTML waits for the
 * first load to finish plus [CaptureDecision.SETTLE_DELAY] so script-rendered
 * content is present, bounded by [CaptureDecision.TIMEOUT]. Never throws: every
 * failure is [CapturedPage.Empty] so the save degrades to a URL-only save.
 */
class HtmlCaptor(private val context: Context) : HtmlCapturing {
	@SuppressLint("SetJavaScriptEnabled")
	override suspend fun capture(url: String): CapturedPage = withContext(Dispatchers.Main) {
		val loaded = CompletableDeferred<CapturedPage?>()
		val webView = WebView(context).apply {
			settings.javaScriptEnabled = true
			settings.domStorageEnabled = true
			settings.userAgentString = AppConfig.WEB_VIEW_USER_AGENT
			settings.loadWithOverviewMode = true
			setDownloadListener { _, _, _, mimeType, _ ->
				when (CaptureDecision.forNavigationResponse(mimeType, isMainFrame = true)) {
					is CaptureDecision.CaptureAsFile -> loaded.complete(CapturedPage.PdfDetected)
					is CaptureDecision.Allow -> loaded.complete(CapturedPage.Empty)
				}
			}
			webViewClient = object : WebViewClient() {
				override fun onPageFinished(view: WebView, url: String?) {
					loaded.complete(null)
				}

				override fun onReceivedHttpError(
					view: WebView,
					request: WebResourceRequest,
					errorResponse: WebResourceResponse,
				) {
					if (request.isForMainFrame && WebResponsePolicy.decide(errorResponse.statusCode) == WebResponsePolicy.FAIL) {
						loaded.complete(CapturedPage.Empty)
					}
				}

				override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
					if (request.isForMainFrame) loaded.complete(CapturedPage.Empty)
				}
			}
		}
		try {
			webView.loadUrl(url)
			val outcome = withTimeoutOrNull(CaptureDecision.TIMEOUT) { loaded.await() }
			when {
				outcome is CapturedPage -> outcome
				else -> {
					// Either the load finished (null) or the timeout elapsed: take
					// whatever the page holds now, after the settle delay when it did finish.
					if (outcome == null && loaded.isCompleted) delay(CaptureDecision.SETTLE_DELAY)
					extract(webView)
				}
			}
		} finally {
			webView.stopLoading()
			webView.destroy()
		}
	}

	private suspend fun extract(webView: WebView): CapturedPage {
		val html = evaluate(webView, "document.documentElement.outerHTML")
		if (html.isNullOrEmpty()) return CapturedPage.Empty
		val title = evaluate(webView, "document.title")?.takeIf { it.isNotEmpty() }
		return CapturedPage.Html(html = html, title = title)
	}

	/** `evaluateJavascript` answers a JSON-encoded string; decode it through a JSON
	 * array so quotes and escapes come back as the page had them. */
	private suspend fun evaluate(webView: WebView, script: String): String? {
		val answer = CompletableDeferred<String?>()
		webView.evaluateJavascript(script) { result -> answer.complete(result) }
		val raw = withTimeoutOrNull(CaptureDecision.SETTLE_DELAY * 5) { answer.await() } ?: return null
		if (raw == "null") return null
		return runCatching { JSONArray("[$raw]").getString(0) }.getOrNull()
	}
}
