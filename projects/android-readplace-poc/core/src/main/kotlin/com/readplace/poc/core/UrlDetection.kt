package com.readplace.poc.core

/**
 * Finds the first http/https URL in free text. Non-web schemes (mailto:, tel:,
 * etc.) are ignored so the share target never POSTs a URL the server would reject
 * for an unsupported scheme.
 */
object UrlDetection {
	private val webUrl = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)

	/** Punctuation that commonly trails a URL in prose without being part of it. */
	private const val TRAILING_NOISE = ".,;:!?]}'\""

	fun firstWebUrl(text: String): String? {
		var candidate = webUrl.find(text)?.value ?: return null
		while (candidate.isNotEmpty()) {
			val last = candidate.last()
			candidate = when {
				last in TRAILING_NOISE -> candidate.dropLast(1)
				// A closing paren is part of the URL when balanced (Wikipedia-style
				// paths like /wiki/Foo_(bar)); only an unmatched one is prose.
				last == ')' && candidate.count { it == '(' } < candidate.count { it == ')' } ->
					candidate.dropLast(1)
				else -> return candidate
			}
		}
		return null
	}
}
