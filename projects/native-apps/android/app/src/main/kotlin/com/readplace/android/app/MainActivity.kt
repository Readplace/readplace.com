package com.readplace.android.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.readplace.android.BuildConfig
import com.readplace.android.core.AppConfig
import com.readplace.android.core.DiscoveryHttpCache
import com.readplace.android.core.ShareArtifacts
import com.readplace.android.core.TokenStore
import com.readplace.android.core.UnseenSave
import com.readplace.android.core.UploadJobStore
import com.readplace.android.core.initWebAuthFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.time.Clock
import java.time.Instant
import kotlin.coroutines.resume

/**
 * The app's composition root: every concrete storage, HTTP, auth and WebView
 * dependency is built here once and handed down, so nothing below reaches for a
 * global or falls back to an in-memory stand-in. It is also the activity the
 * OAuth redirect returns to (singleTask + the `readplace://oauth-callback/android`
 * intent filter), so it forwards that intent and its own resume to the auth relay.
 */
class MainActivity : ComponentActivity() {
	private val relays = AuthRelays()
	private val foreground = MutableStateFlow(false)

	private lateinit var session: AppSession
	private lateinit var listViewModel: ReadingListViewModel
	private lateinit var intro: LaunchIntroModel

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		val store = TokenStore(
			KeystoreTokenStorage(getSharedPreferences(KeystoreTokenStorage.PREFERENCES_NAME, Context.MODE_PRIVATE)),
		)
		val flags = PreferenceFlags(getSharedPreferences(PreferenceFlags.PREFERENCES_NAME, Context.MODE_PRIVATE))
		val jobs = UploadJobStore(filesDir, Dispatchers.IO)
		val unseenSave = UnseenSave(filesDir)
		val discoveryCache = DiscoveryHttpCache(cacheDir)
		val customTabAuth = CustomTabAuth(this, relays)

		session = AppSession(
			baseUrl = AppConfig.serverBaseUrl,
			store = store,
			newClientBuilder = { OkHttpClient.Builder() },
			nativeUserAgent = AppConfig.nativeUserAgent(BuildConfig.VERSION_CODE, Build.VERSION.RELEASE),
			ioDispatcher = Dispatchers.IO,
			scope = lifecycleScope,
			makeWebAuthFlow = { oauth -> initWebAuthFlow(present = { url -> customTabAuth.present(url) }, oauth = oauth) },
			webDataWiper = WebViewDataWiper,
			shareArtifacts = ShareArtifacts(jobs, unseenSave, discoveryCache),
		)

		val api = session.makeApi()
		val captor = HtmlCaptor(this)
		val heal = HealBlockedArticle(api, captor)
		val drain = DrainUploadJobs(api, captor, jobs, now = { Instant.now() })
		listViewModel = ReadingListViewModel(
			api = api,
			unseenSave = unseenSave,
			healBlockedArticle = { url -> heal.run(url) },
			drainUploadJobs = { drain.run() },
			onSessionExpired = { session.forceLogout() },
		)

		val reduceMotion = Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
		intro = LaunchIntroModel(
			seen = LaunchIntroSeen(flags),
			music = SystemIntroMusic(this),
			mutePreference = IntroMutePreference(flags),
			reduceMotion = reduceMotion,
			isLoggedIn = store.isLoggedIn,
		)

		handleCallback(intent)

		setContent {
			val appearance = listViewModel.state.collectAsState().value.appearance
			ReadplaceTheme(darkTheme = AppearancePresentation.isDark(appearance, isSystemInDarkTheme())) {
				Surface(modifier = Modifier.fillMaxSize()) {
					Root(
						session = session,
						listViewModel = listViewModel,
						intro = intro,
						reduceMotion = reduceMotion,
						isForeground = foreground.collectAsStateWithLifecycle().value,
						slogans = { session.makeSloganSource().load() },
						onOpenExternally = ::openExternally,
					)
				}
			}
		}
	}

	override fun onNewIntent(intent: Intent) {
		super.onNewIntent(intent)
		setIntent(intent)
		handleCallback(intent)
	}

	override fun onResume() {
		super.onResume()
		foreground.value = true
		relays.onResume()
	}

	override fun onPause() {
		foreground.value = false
		super.onPause()
	}

	private fun handleCallback(intent: Intent?) {
		val data = intent?.data ?: return
		if (data.scheme == AppConfig.CALLBACK_SCHEME) relays.onCallback(data.toString())
	}

	/** Anything that is not our own auth is handed to the system untouched: on
	 * Android the default browser already carries the user's session, and a link
	 * to another site must stay eligible for that site's own app. */
	private fun openExternally(url: String) {
		startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
	}
}

/**
 * Clears the reader's traces from the process-wide WebView store on sign-out.
 * Android's CookieManager offers no per-host enumeration, so the whole jar goes —
 * the reader is the only thing this app ever loads in a WebView, so nothing of
 * value is lost — along with every non-cookie data type, so a signed-out
 * account's reading history does not stay on disk.
 */
private object WebViewDataWiper : WebDataWiper {
	/** Never throws, matching the iOS seam's non-throwing contract: a device whose
	 * WebView provider is missing must still finish signing out. */
	override suspend fun wipe(serverHost: String) = withContext(Dispatchers.Main) {
		try {
			suspendCancellableCoroutine { continuation ->
				CookieManager.getInstance().removeAllCookies { continuation.resume(Unit) }
			}
			CookieManager.getInstance().flush()
			WebStorage.getInstance().deleteAllData()
		} catch (_: RuntimeException) {
		}
	}
}

@Composable
private fun Root(
	session: AppSession,
	listViewModel: ReadingListViewModel,
	intro: LaunchIntroModel,
	reduceMotion: Boolean,
	isForeground: Boolean,
	slogans: suspend () -> List<String>,
	onOpenExternally: (String) -> Unit,
) {
	val isLoggedIn by session.isLoggedIn.collectAsState()
	val brand = LocalBrandColors.current
	val scope = androidx.compose.runtime.rememberCoroutineScope()
	var authErrorText by remember { mutableStateOf<String?>(null) }
	var authBusy by remember { mutableStateOf(false) }
	var sloganList by remember { mutableStateOf(listOf(AppConfig.FALLBACK_SLOGAN)) }
	val context = androidx.compose.ui.platform.LocalContext.current

	LaunchedEffect(isLoggedIn, isForeground) {
		intro.sync(isLoggedIn = isLoggedIn, isForeground = isForeground)
	}
	LaunchedEffect(isLoggedIn) {
		if (!isLoggedIn) {
			val fetched = slogans()
			if (fetched.isNotEmpty()) sloganList = fetched
		}
	}

	fun authenticate(start: suspend () -> Result<Unit>?) {
		if (authBusy) return
		authBusy = true
		authErrorText = null
		scope.launch {
			try {
				start()?.onFailure { authErrorText = it.message }
			} finally {
				authBusy = false
			}
		}
	}

	Box(modifier = Modifier.fillMaxSize()) {
		if (isLoggedIn) {
			ReadingListScreen(
				viewModel = listViewModel,
				now = Instant.now(),
				isForeground = isForeground,
				onSignOut = { scope.launch { session.logout(); intro.replay() } },
				onOpenExternally = onOpenExternally,
			)
		} else {
			LoginScreen(
				slogans = sloganList,
				errorText = authErrorText,
				reduceMotion = reduceMotion,
				isForeground = isForeground,
				intro = intro,
				onLogin = { authenticate { session.startLogin() } },
				onSignup = { authenticate { session.startSignup() } },
				onOpenPrivacyPolicy = {
					context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AppConfig.privacyPolicyUrl)))
				},
				busy = authBusy,
			)
		}
		LaunchIntroOverlay(model = intro, brand = brand)
	}
}
