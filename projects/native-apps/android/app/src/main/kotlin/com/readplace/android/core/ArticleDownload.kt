package com.readplace.android.core

import java.net.URI

/**
 * Recognises one of *our own* article-file links (`/view/<url>?format=epub`).
 *
 * Every other tapped link leaves the app for a browser. A download has no such
 * reason to: handing it out would drop the reader the user was reading, for a file
 * the WebView can fetch in place and hand to the system downloader.
 *
 * Scoped to our host because a `format=epub` query on someone else's site is their
 * route, not ours, and claiming it would break a link the app has no business
 * interpreting.
 */
fun isArticleDownloadUrl(url: String): Boolean {
	val target = runCatching { URI(url) }.getOrNull() ?: return false
	val serverHost = runCatching { URI(AppConfig.serverBaseUrl).host }.getOrNull()
	if (target.host == null || target.host != serverHost) return false
	return target.rawQuery
		?.split("&")
		?.any { it == "format=epub" } == true
}
