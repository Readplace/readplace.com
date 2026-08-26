package com.readplace.android.app

import com.readplace.android.core.AppConfig
import java.net.URI

/**
 * What the reader's WebView should do with a navigation. Pure and value-comparable
 * so the decision can be unit-tested without a live web view.
 */
sealed interface ReaderNavigationDecision {
	data object Allow : ReaderNavigationDecision

	data object Close : ReaderNavigationDecision

	data object Logout : ReaderNavigationDecision

	data class OpenExternally(val url: String) : ReaderNavigationDecision
}

/**
 * Decides what the Android reader does with each navigation, kept UI-free so the
 * rules are unit-tested directly. The `WebViewClient` is the only untested glue (an
 * OS boundary), like `ReaderBridge` before it.
 */
object ReaderNavigation {
	/**
	 * A footnote tap is a scroll, not a navigation, so it must not open a browser.
	 * No host allowlist — readplace.com article links open in the browser too.
	 *
	 * The `readplace://` deep links are matched ahead of the link-activated branch,
	 * and regardless of navigation type: the account page reaches the logout link
	 * through htmx's `HX-Redirect` (an assignment to `location.href`), not a tap.
	 */
	fun decide(
		url: String,
		isLinkActivated: Boolean,
		currentUrl: String?,
	): ReaderNavigationDecision {
		val target = parse(url)
		val current = currentUrl?.let { parse(it) }
		val deepLink = target?.let { deepLinkDecision(it) }
		return when {
			deepLink != null -> deepLink
			current != null && target?.isSameDocumentFragmentOf(current) == true ->
				ReaderNavigationDecision.Allow
			target == null -> ReaderNavigationDecision.Allow
			isLinkActivated -> ReaderNavigationDecision.OpenExternally(url)
			else -> ReaderNavigationDecision.Allow
		}
	}

	private fun deepLinkDecision(url: URI): ReaderNavigationDecision? {
		if (url.scheme?.lowercase() != AppConfig.CALLBACK_SCHEME) return null
		val host: String? = url.host?.lowercase()
		val path: String? = url.path
		return when (host to path) {
			"reader" to "/close" -> ReaderNavigationDecision.Close
			"account" to "/logout" -> ReaderNavigationDecision.Logout
			else -> null
		}
	}

	private fun URI.isSameDocumentFragmentOf(current: URI): Boolean {
		if (rawFragment == null) return false
		return scheme == current.scheme &&
			host == current.host &&
			port == current.port &&
			path == current.path &&
			// The RAW query, because getQuery() percent-decodes: two queries that differ
			// only in encoding would otherwise compare equal and a real navigation would
			// be mistaken for an in-page fragment jump.
			rawQuery == current.rawQuery
	}

	/** `java.net.URI` rejects characters a browser accepts in a fragment (a space, a
	 * `|`, a `^`), so an unparseable target is not a signal about the navigation —
	 * `decide` treats it as allowed rather than letting a footnote tap escape to a
	 * browser, which is the regression this whole file exists to prevent. */
	private fun parse(value: String): URI? = runCatching { URI(value) }.getOrNull()
}
