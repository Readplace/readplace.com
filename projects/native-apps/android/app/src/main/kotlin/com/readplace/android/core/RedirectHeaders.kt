package com.readplace.android.core

import java.util.TreeMap

/**
 * Re-attaches the headers the client sets itself when a redirect is followed.
 * OkHttp strips `Authorization` on a cross-host redirect and may drop custom
 * headers generally, and the server redirects the entry point to the collection —
 * so a followed redirect that lost them would arrive unauthenticated,
 * unnegotiated, and unattributed to this client. `User-Agent` is on the list for
 * the same reason with one extra edge: OkHttp substitutes its own default when the
 * header is absent, so a lost one misattributes the hop rather than leaving it
 * blank.
 */
object RedirectHeaders {
	val PRESERVED: List<String> = listOf(
		"Authorization",
		"Accept",
		AppConfig.CLIENT_HEADER,
		AppConfig.SAVE_CONTINUITY_HEADER,
		"User-Agent",
	)

	fun preserving(from: Map<String, String>, onto: Map<String, String>): Map<String, String> {
		val original = byCaseInsensitiveName(from)
		val updated = byCaseInsensitiveName(onto)
		for (header in PRESERVED) {
			val value = original[header] ?: continue
			updated[header] = value
		}
		return updated
	}

	private fun byCaseInsensitiveName(headers: Map<String, String>): TreeMap<String, String> =
		TreeMap<String, String>(String.CASE_INSENSITIVE_ORDER).apply { putAll(headers) }
}
