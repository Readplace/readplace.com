package com.readplace.android.core

import java.net.URI

/**
 * Finds the first http/https URL in free text. Non-web schemes (mailto:, tel:,
 * content:, file:) are ignored so the share flow never POSTs a URL the server
 * would reject for an unsupported scheme.
 *
 * Deliberately built on `java.net.URI` rather than `android.net.Uri` or
 * `android.util.Patterns`, so the whole decision stays testable on a plain JVM.
 */
object UrlDetection {
	private val CANDIDATE = Regex("""[A-Za-z][A-Za-z0-9+.\-]*://[^\s<>"']+""")

	fun firstWebUrl(text: String): String? =
		CANDIDATE.findAll(text)
			.map { trimTrailingPunctuation(it.value) }
			.firstOrNull { isWebUrl(it) }

	fun isWebUrl(value: String): Boolean {
		val scheme = runCatching { URI(value).scheme }.getOrNull()?.lowercase() ?: return false
		return scheme == "http" || scheme == "https"
	}

	/** Sentence punctuation that follows a URL in prose is not part of it. A closing
	 * bracket is only dropped when nothing opened it, so a URL that legitimately ends
	 * in one survives. */
	private fun trimTrailingPunctuation(candidate: String): String {
		var end = candidate.length
		while (end > 0) {
			val ch = candidate[end - 1]
			val drop = when (ch) {
				'.', ',', ';', ':', '!', '?', '"', '\'' -> true
				')' -> candidate.count { it == '(' } < candidate.count { it == ')' }
				']' -> candidate.count { it == '[' } < candidate.count { it == ']' }
				else -> false
			}
			if (!drop) break
			end--
		}
		return candidate.substring(0, end)
	}
}
