package com.readplace.android.app

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.readplace.android.core.AppConfig

/**
 * A minimal WebView that loads a single public URL — no cookie injection and no
 * JS bridge, unlike the reader's. Its client reports first-load completion and
 * failure (a transport error or an HTTP error status) through callbacks so the
 * presenting sheet drives its loading and error overlays, and intercepts the
 * page's own `readplace://reader/close` back link to dismiss. WebView glue is an OS
 * boundary left untested; the decisions it applies are the tested
 * [ReaderNavigation] and [WebResponsePolicy].
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebPageSheet(
	url: String,
	onClose: () -> Unit,
	onFinish: () -> Unit,
	onFail: () -> Unit,
) {
	val isDark = LocalIsDarkTheme.current

	AndroidView(
		modifier = Modifier.fillMaxSize(),
		factory = { context ->
			WebView(webContentContext(context, isDark)).apply {
				settings.javaScriptEnabled = true
				settings.domStorageEnabled = true
				// The help page teaches Share with a video; letting it play inline keeps
				// the reader on the instruction they are following.
				settings.mediaPlaybackRequiresUserGesture = false
				settings.userAgentString = AppConfig.WEB_VIEW_USER_AGENT
				webViewClient = object : WebViewClient() {
					override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
						val decision = ReaderNavigation.decide(
							url = request.url.toString(),
							isLinkActivated = request.hasGesture(),
							currentUrl = view.url,
						)
						return when (decision) {
							ReaderNavigationDecision.Close -> {
								onClose()
								true
							}
							else -> false
						}
					}

					override fun onReceivedHttpError(
						view: WebView,
						request: WebResourceRequest,
						errorResponse: WebResourceResponse,
					) {
						if (!request.isForMainFrame) return
						if (WebResponsePolicy.decide(errorResponse.statusCode) == WebResponsePolicy.FAIL) {
							view.stopLoading()
							onFail()
						}
					}

					override fun onReceivedError(
						view: WebView,
						request: WebResourceRequest,
						error: WebResourceError,
					) {
						if (request.isForMainFrame) onFail()
					}

					override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {}

					override fun onPageFinished(view: WebView, url: String?) {
						onFinish()
					}
				}
				loadUrl(url)
			}
		},
	)
}
