package com.readplace.android.app

import android.content.Context
import android.os.Build
import com.readplace.android.BuildConfig
import com.readplace.android.core.AppConfig
import com.readplace.android.core.NativeCleartextPolicy
import com.readplace.android.core.OAuth
import com.readplace.android.core.TokenStore
import okhttp3.OkHttpClient

class ProcessCredentials private constructor(
	val store: TokenStore,
	val oauth: OAuth,
) {
	companion object {
		private var shared: ProcessCredentials? = null

		@Synchronized
		fun of(context: Context): ProcessCredentials =
			shared ?: make(context.applicationContext).also { shared = it }

		private fun make(context: Context): ProcessCredentials {
			val store = TokenStore(
				KeystoreTokenStorage(
					context.getSharedPreferences(KeystoreTokenStorage.PREFERENCES_NAME, Context.MODE_PRIVATE),
				),
			)
			val nativeUserAgent = AppConfig.nativeUserAgent(BuildConfig.VERSION_CODE, Build.VERSION.RELEASE)
			val http = OkHttpClient.Builder()
				.addNetworkInterceptor(NativeCleartextPolicy.forEnvironment(AppConfig.serverEnvironment))
				.build()
			val oauth = OAuth(
				baseUrl = AppConfig.serverBaseUrl,
				store = store,
				http = http,
				nativeUserAgent = nativeUserAgent,
			)
			return ProcessCredentials(store, oauth)
		}
	}
}
