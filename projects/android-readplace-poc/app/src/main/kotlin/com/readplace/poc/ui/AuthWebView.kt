package com.readplace.poc.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.readplace.poc.core.AppConfig
import com.readplace.poc.core.AuthRedirect
import com.readplace.poc.core.AuthorizationRequest

/**
 * Hosts the OAuth authorization page in an embedded WebView and intercepts the
 * navigation to the registered HTTPS callback — the native analogue of the iOS
 * POC's `AuthFlowView`. The result (code, denial, or state mismatch) is delivered
 * exactly once; the server invalidates an authorization code after one exchange,
 * so a double delivery would log the user straight back out. A stock Chrome user
 * agent is presented to reduce Google's "disallowed_useragent" rejections;
 * email/password sign-in works regardless.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AuthWebView(
	request: AuthorizationRequest,
	onResult: (AuthRedirect) -> Unit,
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
					private var delivered = false

					override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean =
						intercept(req.url.toString())

					/**
					 * Server-side redirect chains (302 → callback) bypass
					 * shouldOverrideUrlLoading, so the page-started hook intercepts too.
					 */
					override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
						intercept(url)
					}

					/** Returns true (cancelling the load) once a result has been delivered. */
					private fun intercept(url: String): Boolean {
						if (delivered) return true
						val result = AuthRedirect.from(url, request) ?: return false
						delivered = true
						onResult(result)
						return true
					}
				}
				loadUrl(request.url)
			}
		},
	)
}
