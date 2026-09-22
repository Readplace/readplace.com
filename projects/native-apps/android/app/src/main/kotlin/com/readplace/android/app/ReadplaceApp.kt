package com.readplace.android.app

import android.app.Application
import android.content.Context
import android.os.Build
import com.readplace.android.BuildConfig
import com.readplace.android.core.AppConfig
import com.readplace.android.core.NativeCleartextPolicy
import com.readplace.android.core.OAuth
import com.readplace.android.core.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient

/**
 * The process-wide composition root for credentials.
 *
 * A share arrives in its own activity but the same process (the manifest gives
 * neither activity its own `android:process`), so the app and the share target
 * must resolve ONE [OAuth] owner. Only then do they share a single-flight refresh,
 * one session generation and one pending-refresh slot — which is what lets a
 * delayed 401 adopt the credentials a concurrent refresh already won instead of
 * racing a second refresh, and what lets a logout fence out a refresh still in
 * flight. So the [OAuth], its [TokenStore] and the scope its refresh runs on are
 * built here once and read by both [MainActivity] and the share target's
 * composition root; the per-surface HTTP clients (the app's uncached one, the
 * share target's discovery-cached one) stay where they are, each wired to this
 * one owner.
 */
class ReadplaceApp : Application() {
	val nativeUserAgent: String by lazy {
		AppConfig.nativeUserAgent(BuildConfig.VERSION_CODE, Build.VERSION.RELEASE)
	}

	val tokenStore: TokenStore by lazy {
		TokenStore(
			KeystoreTokenStorage(getSharedPreferences(KeystoreTokenStorage.PREFERENCES_NAME, Context.MODE_PRIVATE)),
		)
	}

	/** Hosts the shared refresh so it outlives any one caller's coroutine: a waiter
	 * that is cancelled cannot cancel a refresh another waiter still needs. The
	 * SupervisorJob keeps a single failed refresh from tearing the scope down. */
	private val refreshScope: CoroutineScope by lazy {
		CoroutineScope(SupervisorJob() + Dispatchers.IO)
	}

	val oauth: OAuth by lazy {
		OAuth(
			baseUrl = AppConfig.serverBaseUrl,
			store = tokenStore,
			http = OkHttpClient.Builder()
				.addNetworkInterceptor(NativeCleartextPolicy.forEnvironment(AppConfig.serverEnvironment))
				.build(),
			nativeUserAgent = nativeUserAgent,
			refreshScope = refreshScope,
		)
	}
}
