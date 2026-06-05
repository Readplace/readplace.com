package com.readplace.poc.core

/**
 * Finds the first http/https URL in free text. Non-web schemes (mailto:, tel:,
 * etc.) are ignored so the share target never POSTs a URL the server would reject
 * for an unsupported scheme.
 */
object UrlDetection {
	private val webUrl = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)

	/** Characters commonly trailing a URL in prose that are not part of it. */
	private val trailingNoise = ".,;:!?)]}'\"".toCharArray()

	fun firstWebUrl(text: String): String? {
		val match = webUrl.find(text)?.value ?: return null
		return match.trimEnd(*trailingNoise).ifEmpty { null }
	}
}
