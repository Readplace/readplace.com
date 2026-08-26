package com.readplace.android.app

/**
 * Whether the in-app web view should render a navigation response or treat it as
 * a failure. The WebView reports a 4xx/5xx through `onReceivedHttpError` and still
 * loads the page, so the web view would otherwise paint the server's error body.
 * Deciding here in a pure value keeps the "an error status fails" policy
 * unit-testable and out of the OS-boundary client, which keeps only the plumbing.
 */
enum class WebResponsePolicy {
	ALLOW,
	FAIL,
	;

	companion object {
		fun decide(statusCode: Int?): WebResponsePolicy =
			if (statusCode != null && statusCode >= 400) FAIL else ALLOW
	}
}
