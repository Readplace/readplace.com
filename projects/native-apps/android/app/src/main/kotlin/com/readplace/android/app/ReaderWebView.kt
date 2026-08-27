package com.readplace.android.app

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Color
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.DialogProperties
import com.readplace.android.core.AppConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Cookie

/**
 * Presents the server's authenticated reader in a WebView — the app acting as a
 * browser over the server's HTML. The reader page and its in-reader XHRs are
 * cookie-session authenticated, so the prefetched session cookie is injected into
 * the web view's cookie store before the first navigation. The server's reader
 * reports back when its own mark-read request completes (an XHR a navigation
 * client can't observe), so the sheet can close and the row can leave the list. An
 * in-process WebView is required over a Custom Tab because only it allows cookie
 * injection and a JS bridge; `WebPageSheet` is the existing WebView precedent.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ReaderWebView(
	url: String,
	cookies: List<Cookie>,
	onMarkedRead: () -> Unit,
	/** Runs the capture of the blocked article and returns once it has settled. The
	 * capture is hosted by the composition root, not the reader, because a WebView
	 * removed from the hierarchy stops laying out and running JS: the root outlives
	 * any manual dismissal of the reader sheet, so a reader closed mid-capture cannot
	 * kill the render it is waiting on (the root launches the work in its own scope
	 * and joins it; a cancelled join leaves the work running). The reader itself
	 * stays open and its own htmx poll swaps in the healed article. */
	onCaptureBlocked: suspend () -> Unit,
	onClose: () -> Unit,
	/** The account page deleted the account, so the server destroyed every session
	 * and redirected here rather than to the logged-out home — the sheet dismisses
	 * and the app signs itself out instead of rendering marketing chrome in-sheet. */
	onLogout: () -> Unit,
	/** Injected so the composition point wires the live browser and tests inject
	 * their own; there is deliberately no internal default. */
	onOpenExternally: (String) -> Unit,
	/** Reports the page's load lifecycle (start → commit → finish/fail plus live
	 * progress) so the sheet can drive its skeleton and progress bar. The reader page
	 * load is otherwise invisible to the sheet. */
	onLoadPhaseChange: (ReaderLoadPhase) -> Unit,
	modifier: Modifier = Modifier,
) {
	val scope = rememberCoroutineScope()
	var pendingDialog by remember { mutableStateOf<PendingWebDialog?>(null) }
	var webView by remember { mutableStateOf<WebView?>(null) }
	var canGoBack by remember { mutableStateOf(false) }
	val isDark = isSystemInDarkTheme()

	BackHandler(enabled = canGoBack) { webView?.goBack() }

	AndroidView(
		modifier = modifier,
		factory = { context ->
			WebView(webContentContext(context, isDark)).apply {
				settings.javaScriptEnabled = true
				// The WebView's cookie and DOM stores are the persistent, app-wide default:
				// state written inside one open must survive to the next one. Two dismissals
				// depend on it — the share hint's localStorage flag, and the changelog
				// banner's cookie, which the reader's own no-JS dismiss form POSTs so an
				// announcement waved away on one article stays away on the next. The
				// session cookie also persists here, but it is re-injected per open (below)
				// and wiped on sign-out.
				settings.domStorageEnabled = true
				settings.userAgentString = AppConfig.WEB_VIEW_USER_AGENT
				// Let the sheet's background show through until the page paints, so the
				// moment the skeleton lifts there is no white flash before the first paint.
				setBackgroundColor(Color.TRANSPARENT)

				val load = ReaderLoadReporter(onLoadPhaseChange)
				webViewClient = ReaderNavigationClient(
					load = load,
					onClose = onClose,
					onLogout = onLogout,
					onOpenExternally = onOpenExternally,
					onCanGoBackChange = { canGoBack = it },
				)
				// The progress client is attached before the first navigation starts so the
				// sheet's bar tracks it from zero.
				webChromeClient = ReaderChromeClient(load = load, present = { pendingDialog = it })

				// The server's chromeless reader posts the mark-read message itself; the app
				// only registers the bridge and reacts. It injects no script, so it holds no
				// knowledge of the reader front-end's htmx internals.
				val bridge = ReaderBridge(
					scope = scope,
					onMarkedRead = onMarkedRead,
					onCaptureBlocked = onCaptureBlocked,
					onMainThread = { action -> post { action() } },
				)
				addJavascriptInterface(bridge, bridge.name)

				loadAuthenticated(url, cookies)
				webView = this
			}
		},
		onRelease = { it.destroy() },
	)

	pendingDialog?.let { pending ->
		WebDialogAlert(pending = pending, onAnswered = { pendingDialog = null })
	}
}

/**
 * Injects every prefetched session cookie into the web view's own store before the
 * first navigation, so the reader and its in-reader XHRs are authenticated from the
 * first request. The client forwards whatever the bootstrap set rather than picking
 * one by name, so a server cookie change needs no app release. One function so the
 * ordering is structural: the WebView already exists (it is the receiver) before
 * the cookie store is touched, the cookies are set and flushed, and only then does
 * the navigation start.
 */
private fun WebView.loadAuthenticated(url: String, cookies: List<Cookie>) {
	val store = CookieManager.getInstance()
	for (cookie in cookies) store.setCookie(url, cookie.toString())
	store.flush()
	loadUrl(url)
}

/**
 * Whether the main frame has committed (started painting) and whether the load has
 * already reached a terminal outcome. The first terminal outcome wins: a later
 * navigation on the same view (an in-page link, a back press through the reader's
 * history) must not re-show the skeleton over a good page.
 */
private class ReaderLoadReporter(private val onLoadPhaseChange: (ReaderLoadPhase) -> Unit) {
	private var committed = false
	private var terminal = false

	fun pageStarted() {
		committed = false
		emit(ReaderLoadPhase.Loading)
	}

	fun pageCommitted(progress: Double) {
		committed = true
		emit(ReaderLoad.rendering(progress))
	}

	/** Progress reports (delivered on the main thread) advance the bar. Pre-commit
	 * progress is unreliable — it spikes to 100 and drops back before the main frame
	 * commits — so the bar only tracks it once committed; before that the skeleton
	 * covers the wait. */
	fun progressed(progress: Double) {
		if (!committed) return
		emit(ReaderLoad.rendering(progress))
	}

	fun pageFinished() {
		if (terminal) return
		terminal = true
		onLoadPhaseChange(ReaderLoadPhase.Finished)
	}

	/** A cancellation the reader provokes (a redirect superseding the first
	 * navigation, an external link opened in the browser) is not a page-load
	 * failure, so it neither settles the load nor shows the error view — the
	 * redirected navigation's commit/finish still resolves it. */
	fun pageFailed(errorCode: Int?) {
		if (terminal || !ReaderLoad.isRealFailure(errorCode)) return
		terminal = true
		onLoadPhaseChange(ReaderLoadPhase.Failed)
	}

	/** Reports an in-flight phase unless the load already settled. */
	private fun emit(phase: ReaderLoadPhase) {
		if (terminal) return
		onLoadPhaseChange(phase)
	}
}

private class ReaderNavigationClient(
	private val load: ReaderLoadReporter,
	private val onClose: () -> Unit,
	private val onLogout: () -> Unit,
	private val onOpenExternally: (String) -> Unit,
	private val onCanGoBackChange: (Boolean) -> Unit,
) : WebViewClient() {
	override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
		val decision = ReaderNavigation.decide(
			url = request.url.toString(),
			isLinkActivated = request.hasGesture(),
			currentUrl = view.url,
		)
		return when (decision) {
			ReaderNavigationDecision.Allow -> false
			ReaderNavigationDecision.Close -> {
				onClose()
				true
			}
			ReaderNavigationDecision.Logout -> {
				// Overridden, so the WebView never tries to resolve the custom scheme.
				onLogout()
				true
			}
			is ReaderNavigationDecision.OpenExternally -> {
				onOpenExternally(decision.url)
				true
			}
		}
	}

	override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
		load.pageStarted()
	}

	override fun onPageCommitVisible(view: WebView, url: String?) {
		// Content is now painting, so the skeleton lifts here — not at
		// `onPageFinished`, which can lag far behind first paint (or never arrive for
		// a hung subresource) and would strand the skeleton over a rendered page.
		load.pageCommitted(view.progress / PROGRESS_SCALE)
	}

	override fun onPageFinished(view: WebView, url: String?) {
		load.pageFinished()
	}

	override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
		if (request.isForMainFrame) load.pageFailed(error.errorCode)
	}

	override fun onReceivedHttpError(
		view: WebView,
		request: WebResourceRequest,
		errorResponse: WebResourceResponse,
	) {
		if (!request.isForMainFrame) return
		if (WebResponsePolicy.decide(errorResponse.statusCode) == WebResponsePolicy.FAIL) {
			view.stopLoading()
			load.pageFailed(errorCode = null)
		}
	}

	override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
		onCanGoBackChange(view.canGoBack())
	}
}

/**
 * Without a WebChromeClient the WebView suppresses JS dialogs and answers `false`,
 * so a server page that gates an action behind `window.confirm()` would silently
 * do nothing in-app. The panel-kind → dialog mapping is the pure, unit-tested
 * `WebDialog`; these hand the native answer straight to the WebView's `JsResult`
 * (exactly once on every path — `WebDialog`'s contract). `prompt()` is
 * deliberately unimplemented: no server page uses it, and the suppressed default
 * (null) is the correct refusal.
 */
private class ReaderChromeClient(
	private val load: ReaderLoadReporter,
	private val present: (PendingWebDialog) -> Unit,
) : WebChromeClient() {
	override fun onProgressChanged(view: WebView, newProgress: Int) {
		load.progressed(newProgress / PROGRESS_SCALE)
	}

	override fun onJsConfirm(view: WebView, url: String?, message: String, result: JsResult): Boolean {
		presentWebDialog(WebDialog.confirm(message), over = view, present = present) { answer ->
			if (answer) result.confirm() else result.cancel()
		}
		return true
	}

	override fun onJsAlert(view: WebView, url: String?, message: String, result: JsResult): Boolean {
		presentWebDialog(WebDialog.alert(message), over = view, present = present) { result.confirm() }
		return true
	}
}

private const val PROGRESS_SCALE = 100.0

/** A JS dialog awaiting the user's answer, held as state by the composable that
 * hosts the web view so the alert composes inside the sheet presenting it. */
private class PendingWebDialog(val dialog: WebDialog, val answer: (Boolean) -> Unit)

/**
 * Presents a dialog as a native alert over the web view, answering exactly once on
 * every path. The alert is state on the composable hosting the web view, so it is
 * composed inside the sheet that presents the web view — presented from the
 * activity behind the sheet's window it would sit hidden and leave the page's
 * script hanging on an unanswered handler — and it cannot be dismissed by a tap
 * outside or the back button, so the only way out is a choice that answers. A web
 * view with no window (mid-dismissal) answers `unpresentedAnswer` instead of
 * presenting nowhere.
 */
private fun presentWebDialog(
	dialog: WebDialog,
	over: WebView,
	present: (PendingWebDialog) -> Unit,
	answer: (Boolean) -> Unit,
) {
	if (!over.isAttachedToWindow) {
		answer(dialog.unpresentedAnswer)
		return
	}
	present(PendingWebDialog(dialog, answer))
}

@Composable
private fun WebDialogAlert(pending: PendingWebDialog, onAnswered: () -> Unit) {
	AlertDialog(
		onDismissRequest = {},
		properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
		text = { Text(text = pending.dialog.message) },
		confirmButton = {
			Row {
				for (choice in pending.dialog.choices) {
					TextButton(
						onClick = {
							onAnswered()
							pending.answer(choice.answer)
						},
						colors = choiceColors(choice.style),
					) {
						Text(text = choice.title)
					}
				}
			}
		},
	)
}

@Composable
private fun choiceColors(style: WebDialog.Choice.Style): ButtonColors =
	when (style) {
		WebDialog.Choice.Style.DESTRUCTIVE ->
			ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
		WebDialog.Choice.Style.CANCEL, WebDialog.Choice.Style.DEFAULT -> ButtonDefaults.textButtonColors()
	}

/**
 * The native side of the reader's mark-read bridge. The reader's mark-read is an
 * htmx form whose XHR never triggers a navigation, so a WebViewClient can't observe
 * it. Rather than the app injecting a script that sniffs the front-end's htmx
 * events, the server's chromeless reader posts the message itself (the htmx
 * coupling stays on the server that owns htmx); the app only registers this
 * interface and interprets the message. The pure message router is unit-tested;
 * the WebView glue that registers and receives it is left untested (OS boundary).
 */
private class ReaderBridge(
	private val scope: CoroutineScope,
	private val onMarkedRead: () -> Unit,
	private val onCaptureBlocked: suspend () -> Unit,
	private val onMainThread: (() -> Unit) -> Unit,
) {
	/** The one name the interface is registered under; the same name is what the
	 * router checks, so registration and routing cannot drift apart. */
	val name: String = ReaderMessageRoute.BRIDGE_NAME

	private var handled = false
	private var capturing = false

	/** The WebView calls this on its JavaScript thread; the routing runs on the
	 * main thread, where the callbacks and the capture live. */
	@JavascriptInterface
	fun postMessage(json: String) {
		val messageType = messageType(json)
		onMainThread { route(messageType) }
	}

	private fun route(messageType: String?) {
		val route = ReaderMessageRoute.of(
			channelName = name,
			messageType = messageType,
			captureInFlight = capturing,
			alreadyMarkedRead = handled,
		)
		when (route) {
			ReaderMessageRoute.START_CAPTURE -> {
				capturing = true
				scope.launch {
					try {
						onCaptureBlocked()
					} finally {
						capturing = false
					}
				}
			}
			ReaderMessageRoute.MARK_READ -> {
				handled = true
				onMarkedRead()
			}
			ReaderMessageRoute.IGNORE -> Unit
		}
	}

	private fun messageType(json: String): String? {
		val payload = try {
			Json.parseToJsonElement(json)
		} catch (_: SerializationException) {
			return null
		}
		val type = (payload as? JsonObject)?.get("type") as? JsonPrimitive ?: return null
		return if (type.isString) type.content else null
	}
}
