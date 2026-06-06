package com.readplace.poc.core.http

/** An HTTP request. Bodies are raw bytes so the same type carries form and JSON payloads. */
data class HttpRequest(
	val url: String,
	val method: String = "GET",
	val headers: Map<String, String> = emptyMap(),
	val body: ByteArray? = null,
) {
	/** Returns a copy with the given headers added/overridden (case-sensitive keys). */
	fun withHeaders(vararg extra: Pair<String, String>): HttpRequest =
		copy(headers = headers + extra)

	override fun equals(other: Any?): Boolean {
		if (this === other) return true
		if (other !is HttpRequest) return false
		return url == other.url &&
			method == other.method &&
			headers == other.headers &&
			(body?.contentEquals(other.body ?: ByteArray(0)) ?: (other.body == null))
	}

	override fun hashCode(): Int {
		var result = url.hashCode()
		result = 31 * result + method.hashCode()
		result = 31 * result + headers.hashCode()
		result = 31 * result + (body?.contentHashCode() ?: 0)
		return result
	}
}

/** An HTTP response. Header lookups are case-insensitive via [header]. */
class HttpResponse(
	val status: Int,
	headers: Map<String, String>,
	val body: ByteArray,
) {
	private val headers: Map<String, String> = headers.mapKeys { it.key.lowercase() }

	fun header(name: String): String? = headers[name.lowercase()]

	val bodyText: String get() = body.decodeToString()
}

/**
 * The transport seam. Implementations MUST NOT follow redirects — the Siren walker
 * follows them itself so it can preserve the `Authorization`/`Accept` headers that
 * cross-origin redirects would otherwise drop (the entry point `GET /` 303-redirects
 * to `/queue`, and a `delete` 303-redirects back to the refreshed collection).
 */
interface HttpClient {
	fun execute(request: HttpRequest): HttpResponse
}
