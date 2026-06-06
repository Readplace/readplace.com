package com.readplace.poc.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.readplace.poc.core.AppConfig
import com.readplace.poc.core.AuthorizationRequest

/**
 * Hosts the OAuth authorization page in an embedded WebView and intercepts the
 * navigation to the registered HTTPS callback to lift the `code` — the native
 * analogue of the iOS POC's `AuthFlowView`. A stock Chrome user agent is presented
 * to reduce Google's "disallowed_useragent" rejections; email/password sign-in works
 * regardless.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AuthWebView(
	request: AuthorizationRequest,
	onCode: (String) -> Unit,
	onCancel: () -> Unit,
) {
	BackHandler(onBack = onCancel)

	AndroidView(
		modifier = Modifier.fillMaxSize(),
		factory = { context ->
			WebView(context).apply {
				settings.javaScriptEnabled = true
				settings.domStorageEnabled = true
				settings.userAgentString = AppConfig.WEB_VIEW_USER_AGENT
				webViewClient = object : WebViewClient() {
					override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean =
						interceptRedirect(req.url.toString())

					override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
						interceptRedirect(url)
					}

					/** Returns true (cancelling the load) once the callback URL yields a matching code. */
					private fun interceptRedirect(url: String): Boolean {
						if (!url.startsWith(request.redirectUri)) return false
						val uri = Uri.parse(url)
						val code = uri.getQueryParameter("code")
						if (code != null && uri.getQueryParameter("state") == request.state) {
							onCode(code)
							return true
						}
						return false
					}
				}
				loadUrl(request.url)
			}
		},
	)
}
