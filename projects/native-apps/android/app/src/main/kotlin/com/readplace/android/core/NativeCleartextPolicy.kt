package com.readplace.android.core

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/**
 * Keeps the app's own OkHttp clients (the API, OAuth and the external content
 * fetch) to the transport rule they had before the application-wide network
 * security config began permitting cleartext.
 *
 * That config had to open cleartext app-wide so the capture and reader WebViews
 * can load http-only article pages — the capability iOS gets from
 * `NSAllowsArbitraryLoadsInWebContent`, for which Android offers no per-WebView
 * analogue. Opening it app-wide would otherwise also let a native request travel
 * over http; this policy closes that back off at the one seam that can be scoped
 * to the app's clients rather than to a WebView: an OkHttp interceptor.
 *
 * Installed as a *network* interceptor (never an application one) so it sees every
 * network hop — the API's hand-walked redirects and OAuth's automatic ones alike —
 * and refuses a cleartext hop to a non-permitted host before that hop's request is
 * written, surfacing as the same [IOException] a transport failure already raises
 * so existing failure handling is unchanged. The permitted-host set is fixed by
 * the build flavor ([forEnvironment]) and never read from the request, so a
 * redirect cannot talk the policy into a host it would not otherwise allow.
 */
class NativeCleartextPolicy(private val cleartextHosts: Set<String>) : Interceptor {
	override fun intercept(chain: Interceptor.Chain): Response {
		val request = chain.request()
		if (forbids(request.url.scheme, request.url.host)) {
			throw IOException("Cleartext HTTP to ${request.url.host} is not permitted for native requests")
		}
		return chain.proceed(request)
	}

	/** Whether this build's policy forbids a native request to [scheme]://[host]:
	 * cleartext (`http`) is refused unless [host] is one the flavor permits, and
	 * every https destination is allowed. A pure decision so it is exercised without
	 * a live socket. */
	fun forbids(scheme: String, host: String): Boolean =
		scheme == "http" && host !in cleartextHosts

	companion object {
		/** The policy for a build environment ([AppConfig.serverEnvironment]).
		 * Production and staging permit no cleartext at all — every native request
		 * must be https. Local additionally permits the loopback/dev hosts the
		 * emulator reaches a hutch dev server through, the same cleartext the removed
		 * local-only network-security config used to grant. */
		fun forEnvironment(environment: String): NativeCleartextPolicy =
			NativeCleartextPolicy(
				when (environment) {
					"local" -> setOf("localhost", "127.0.0.1", "10.0.2.2")
					else -> emptySet()
				},
			)
	}
}
