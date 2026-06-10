package com.readplace.poc.core

import java.net.URLDecoder

/**
 * The terminal outcome of the authorization web flow, parsed from a navigation
 * inside the auth WebView — the Kotlin analogue of the iOS coordinator's
 * intercept + `handleCallback` pair.
 */
sealed interface AuthRedirect {
	data class Granted(val code: String) : AuthRedirect
	data class Failed(val message: String) : AuthRedirect

	companion object {
		/**
		 * Returns null while the navigation is not the registered callback carrying a
		 * result (`code` or `error`) — e.g. the consent page itself, or the bare
		 * callback URL without parameters. The caller must deliver the first non-null
		 * result exactly once; the server invalidates a code after one exchange.
		 */
		fun from(url: String, request: AuthorizationRequest): AuthRedirect? {
			if (!url.startsWith(request.redirectUri)) return null
			val params = queryParams(url)
			params["error"]?.let { return Failed("Authorization was denied ($it).") }
			val code = params["code"] ?: return null
			if (params["state"] != request.state) return Failed("Security check failed (state mismatch).")
			return Granted(code)
		}

		private fun queryParams(url: String): Map<String, String> {
			val query = url.substringAfter('?', missingDelimiterValue = "").substringBefore('#')
			if (query.isEmpty()) return emptyMap()
			return query.split("&").mapNotNull { pair ->
				val parts = pair.split("=", limit = 2)
				if (parts.size == 2) {
					URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts[1], "UTF-8")
				} else {
					null
				}
			}.toMap()
		}
	}
}
