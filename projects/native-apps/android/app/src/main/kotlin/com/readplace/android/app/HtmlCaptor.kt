package com.readplace.android.app

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.readplace.android.core.AppConfig
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import kotlin.coroutines.resume

/**
 * Renders a page in a WebView hosted off-screen and hands back its DOM. The main
 * frame's media type decides what happens through the tested [CaptureDecision]: a
 * PDF is never rendered — the WebView cannot, and reports it as a download, which
 * is the one signal Android gives for the main frame's type — while HTML waits for
 * the first load to finish plus [CaptureDecision.SETTLE_DELAY] so script-rendered
 * content is present, bounded by [CaptureDecision.TIMEOUT]. Never throws: every
 * failure — a load error, a timeout, or a setup failure — degrades to
 * [CapturedPage.Empty] so the save falls back to a URL-only save.
 *
 * The WebView is parented into the current screen's laid-out root ([captureHost])
 * behind everything visible, so it has a real phone-sized viewport before it
 * loads — an unhosted WebView measures 0×0, and a page whose lazy content, media
 * queries or `IntersectionObserver` gate on a nonzero viewport would render blank.
 * This mirrors the iOS captor, which hosts its WKWebView at the host's bounds. The
 * host stays transparent, non-interactive and hidden from accessibility, and the
 * WebView is removed and destroyed on every exit — normal, timeout, or cancel.
 */
class HtmlCaptor(
	private val context: Context,
	/** Resolves the laid-out view the capture WebView is parented into, read once
	 * per capture rather than held, so nothing here outlives the Activity. */
	private val captureHost: () -> ViewGroup,
) : HtmlCapturing {
	@SuppressLint("SetJavaScriptEnabled")
	override suspend fun capture(url: String): CapturedPage = withContext(Dispatchers.Main) {
		val loaded = CompletableDeferred<CapturedPage?>()
		// Setup lives inside the try so a throwing WebView provider or host lookup
		// still hits the finally (no leak) and the catch (no escape past the
		// never-throw contract the heal/drain/share callers rely on).
		var webView: WebView? = null
		var host: ViewGroup? = null
		try {
			val view = WebView(context).apply {
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

					override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
						if (request.isForMainFrame) loaded.complete(CapturedPage.Empty)
					}
				}
			}
			webView = view
			val resolvedHost = captureHost()
			host = resolvedHost
			hostOffScreen(resolvedHost, view)
			// The layout wait shares the one capture timeout, so hosting cannot add
			// an unbounded suspension: if the budget elapses before the viewport is
			// laid out, navigation never starts and there is nothing to extract.
			var navigationStarted = false
			val settledPage = withTimeoutOrNull(CaptureDecision.TIMEOUT) {
				awaitNonZeroLayout(view)
				navigationStarted = true
				view.loadUrl(url)
				loaded.await()
			}
			when (val resolution = CaptureResolution.of(settledPage, navigationStarted, loaded.isCompleted)) {
				is CaptureResolution.Settled -> resolution.page
				CaptureResolution.NothingLoaded -> CapturedPage.Empty
				CaptureResolution.ExtractAfterSettle -> {
					delay(CaptureDecision.SETTLE_DELAY)
					extract(view)
				}
				CaptureResolution.ExtractPartial -> extract(view)
			}
		} catch (cancelled: CancellationException) {
			// A cancelled capture (the Activity went away mid-render) is not a
			// failure to report — let structured concurrency unwind it.
			throw cancelled
		} catch (_: Exception) {
			CapturedPage.Empty
		} finally {
			val view = webView
			if (view != null) {
				view.stopLoading()
				host?.removeView(view)
				view.destroy()
			}
		}
	}

	/** Parents the WebView behind everything visible (index 0) at the host's own
	 * measured pixel bounds, so it lays out at a real phone viewport without any
	 * density arithmetic and follows the host through a resize. Transparent, and
	 * non-interactive to both touch and focus so a stray tap during capture never
	 * reaches the page (mirroring the iOS captor's `isUserInteractionEnabled =
	 * false`), and hidden from accessibility so it is not read out. */
	@SuppressLint("ClickableViewAccessibility")
	private fun hostOffScreen(host: ViewGroup, webView: WebView) {
		webView.layoutParams = ViewGroup.LayoutParams(
			ViewGroup.LayoutParams.MATCH_PARENT,
			ViewGroup.LayoutParams.MATCH_PARENT,
		)
		webView.alpha = 0f
		webView.isFocusable = false
		webView.isFocusableInTouchMode = false
		webView.setOnTouchListener { _, _ -> true }
		webView.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
		host.addView(webView, 0)
	}

	/** Suspends until the view has a nonzero measured layout, so a load never
	 * starts against a 0×0 viewport. Resolves at once when the view is already
	 * laid out; otherwise waits for the first layout pass, removing its listener on
	 * both completion and cancellation so a timed-out wait leaves nothing attached. */
	private suspend fun awaitNonZeroLayout(view: View) {
		if (view.width > 0 && view.height > 0) return
		suspendCancellableCoroutine<Unit> { continuation ->
			val listener = object : ViewTreeObserver.OnGlobalLayoutListener {
				override fun onGlobalLayout() {
					if (view.width > 0 && view.height > 0) {
						removeLayoutListener(view, this)
						if (continuation.isActive) continuation.resume(Unit)
					}
				}
			}
			view.viewTreeObserver.addOnGlobalLayoutListener(listener)
			continuation.invokeOnCancellation { removeLayoutListener(view, listener) }
		}
	}

	private fun removeLayoutListener(view: View, listener: ViewTreeObserver.OnGlobalLayoutListener) {
		if (view.viewTreeObserver.isAlive) view.viewTreeObserver.removeOnGlobalLayoutListener(listener)
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
