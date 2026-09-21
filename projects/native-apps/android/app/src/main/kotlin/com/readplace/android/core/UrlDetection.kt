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
			.firstNotNullOfOrNull(::normalizeWebUrl)

	fun normalizeWebUrl(value: String): String? {
		val normalized = encodeBrowserSupportedSuffix(value)
		val scheme = runCatching { URI(normalized).scheme }.getOrNull()?.lowercase() ?: return null
		return if (scheme == "http" || scheme == "https") normalized else null
	}

	/** `^` and `|` are the two characters a browser and iOS's Foundation URL accept
	 * but `java.net.URI` rejects; encoding them in the path, query and fragment brings
	 * the share flow to the same save behaviour. Only the suffix is touched — a `^` or
	 * `|` in the authority is left literal so the parser still rejects it, rather than
	 * a rewrite turning a malformed host into an accepted one. Existing percent escapes
	 * survive because only the two literal characters are replaced. */
	private fun encodeBrowserSupportedSuffix(value: String): String {
		val schemeSeparator = value.indexOf("://")
		if (schemeSeparator < 0) return value
		val suffixStart = value.indexOfAny(charArrayOf('/', '?', '#'), startIndex = schemeSeparator + 3)
		if (suffixStart < 0) return value
		val suffix = value.substring(suffixStart).replace("^", "%5E").replace("|", "%7C")
		return value.substring(0, suffixStart) + suffix
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
