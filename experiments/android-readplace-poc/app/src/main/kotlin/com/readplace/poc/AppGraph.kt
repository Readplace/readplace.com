package com.readplace.poc

import android.content.Context
import com.readplace.poc.core.OAuthService
import com.readplace.poc.core.ReadplaceApi
import com.readplace.poc.core.TokenStore
import com.readplace.poc.core.http.HttpClient
import com.readplace.poc.core.http.UrlConnectionHttpClient
import com.readplace.poc.platform.SharedPrefsKeyValueStore

/**
 * The composition root. Wires the shared core's production implementations together
 * — every dependency is explicit here, nothing defaults to an in-memory stub. The
 * launcher app and the share target each build one against the same `SharedPreferences`,
 * so the token the app stores is visible to the share target (same app sandbox; no
 * iOS-style App Group needed).
 */
class AppGraph(context: Context) {
	private val http: HttpClient = UrlConnectionHttpClient()
	val tokenStore: TokenStore = TokenStore(SharedPrefsKeyValueStore(context))

	fun oauth(baseUrl: String = tokenStore.baseUrl): OAuthService = OAuthService(baseUrl, tokenStore, http)

	fun api(baseUrl: String = tokenStore.baseUrl): ReadplaceApi =
		ReadplaceApi(baseUrl, tokenStore, http, oauth(baseUrl))
}
