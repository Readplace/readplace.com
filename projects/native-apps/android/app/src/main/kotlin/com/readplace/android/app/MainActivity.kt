package com.readplace.android.app

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.readplace.android.BuildConfig
import com.readplace.android.core.AppConfig
import com.readplace.android.core.DiscoveryHttpCache
import com.readplace.android.core.NativeCleartextPolicy
import com.readplace.android.core.ShareArtifacts
import com.readplace.android.core.SloganDiagnostics
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
import kotlin.random.Random
import kotlin.random.nextULong

/** How long each slogan stands before it hands over to the next — the storm's
 * 12-second cycle, matching iOS. */
private const val SLOGAN_INTERVAL_MILLIS = 12_000L

/**
 * The app's composition root. It is also the activity the OAuth redirect returns
 * to (singleTask + the `readplace://oauth-callback/android` intent filter), so it
 * forwards that intent and its own resume to the auth relay.
 */
class MainActivity : ComponentActivity() {
	private val relays = AuthRelays()
	private val foreground = MutableStateFlow(false)

	private lateinit var session: AppSession
	private lateinit var intro: LaunchIntroModel

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		// API 35+ enforces this; the call brings 29-34 in line so the intro fills behind the system bars.
		enableEdgeToEdge()
		val credentials = ProcessCredentials.of(this)
		val store = credentials.store
		val flags = PreferenceFlags(getSharedPreferences(PreferenceFlags.PREFERENCES_NAME, Context.MODE_PRIVATE))
		val jobs = UploadJobStore(filesDir, Dispatchers.IO)
		val unseenSave = UnseenSave(filesDir)
		val discoveryCache = DiscoveryHttpCache(cacheDir)
		val customTabAuth = CustomTabAuth(this, relays)

		session = AppSession(
			baseUrl = AppConfig.serverBaseUrl,
			store = store,
			oauth = credentials.oauth,
			newClientBuilder = {
				OkHttpClient.Builder()
					.addNetworkInterceptor(NativeCleartextPolicy.forEnvironment(AppConfig.serverEnvironment))
			},
			nativeUserAgent = AppConfig.nativeUserAgent(BuildConfig.VERSION_CODE, Build.VERSION.RELEASE),
			ioDispatcher = Dispatchers.IO,
			scope = lifecycleScope,
			makeWebAuthFlow = { oauth -> initWebAuthFlow(present = { url -> customTabAuth.present(url) }, oauth = oauth) },
			webDataWiper = WebViewDataWiper,
			shareArtifacts = ShareArtifacts(jobs, unseenSave, discoveryCache),
			sloganDiagnostics = SloganDiagnostics { failure -> Log.w("Slogans", "slogan load failed: $failure") },
		)

		val api = session.makeApi()
		val captor = HtmlCaptor(this) { findViewById(android.R.id.content) }
		val heal = HealBlockedArticle(api, captor)
		val drain = DrainUploadJobs(api, captor, jobs, now = { Instant.now() })
		val createReadingList: () -> ReadingListViewModel = {
			ReadingListViewModel(
				api = api,
				unseenSave = unseenSave,
				healBlockedArticle = { url -> heal.run(url) },
				drainUploadJobs = { drain.run() },
				onSessionExpired = { session.forceLogout() },
			)
		}

		val reduceMotionSetting = SystemReduceMotion(contentResolver)
		val reduceMotionUpdates = reduceMotionSetting.updates()
		val reduceMotion = reduceMotionSetting.current()
		intro = ViewModelProvider(
			this,
			viewModelFactory {
				initializer {
					val music = SystemIntroMusic(applicationContext)
					LaunchIntroOwner(
						model = LaunchIntroModel(
							seen = LaunchIntroSeen(flags),
							music = music,
							mutePreference = IntroMutePreference(flags),
							reduceMotion = reduceMotion,
							isLoggedIn = store.isLoggedIn,
						),
						music = music,
					)
				}
			},
		).get(LaunchIntroOwner::class).model

		// The sign-in motion's clock and seed are fixed here, at the root, before the
		// intro or login appears: the storm clock starts at app launch and, held in an
		// Activity-scoped ViewModel, survives recreation and signing back out to login
		// so no second storm begins where the first left off.
		val rotation = ViewModelProvider(
			this,
			viewModelFactory {
				initializer {
					SloganRotationOwner(
						SloganRotation(
							seed = Random.nextULong(),
							intervalMillis = SLOGAN_INTERVAL_MILLIS,
							startedAt = Instant.now(),
							fallback = AppConfig.FALLBACK_SLOGAN,
						),
					)
				}
			},
		).get(SloganRotationOwner::class).rotation

		handleCallback(intent)

		setContent {
			ReadplaceTheme {
				Surface(modifier = Modifier.fillMaxSize()) {
					Root(
						session = session,
						createReadingList = createReadingList,
						intro = intro,
						rotation = rotation,
						reduceMotion = reduceMotionUpdates
							.collectAsStateWithLifecycle(initialValue = reduceMotion).value,
						isForeground = foreground.collectAsStateWithLifecycle().value,
						loadSlogans = { session.makeSloganSource().load() },
						onOpenExternally = ::openExternally,
						applySystemBarIcons = ::applySystemBarIcons,
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

	private fun applySystemBarIcons(needLightIcons: Boolean) {
		val controller = WindowCompat.getInsetsController(window, window.decorView)
		controller.isAppearanceLightStatusBars = !needLightIcons
		controller.isAppearanceLightNavigationBars = !needLightIcons
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

private class SystemReduceMotion(private val resolver: ContentResolver) : ReduceMotionSetting {
	override fun current(): Boolean =
		Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

	override fun observe(onChange: () -> Unit): AutoCloseable {
		val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
			override fun onChange(selfChange: Boolean) = onChange()
		}
		resolver.registerContentObserver(
			Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
			false,
			observer,
		)
		return AutoCloseable { resolver.unregisterContentObserver(observer) }
	}
}

@Composable
private fun Root(
	session: AppSession,
	createReadingList: () -> ReadingListViewModel,
	intro: LaunchIntroModel,
	rotation: SloganRotation,
	reduceMotion: Boolean,
	isForeground: Boolean,
	loadSlogans: suspend () -> List<String>,
	onOpenExternally: (String) -> Unit,
	applySystemBarIcons: (needLightIcons: Boolean) -> Unit,
) {
	val isLoggedIn by session.isLoggedIn.collectAsState()
	val introPhase by intro.phase.collectAsState()
	val introBackdropIsDark = LaunchIntro.overlay(introPhase).usesDarkBackdrop
	val brand = LocalBrandColors.current
	val scope = androidx.compose.runtime.rememberCoroutineScope()
	var authErrorText by remember { mutableStateOf<String?>(null) }
	var authBusy by remember { mutableStateOf(false) }
	val context = androidx.compose.ui.platform.LocalContext.current

	LaunchedEffect(isLoggedIn, isForeground) {
		intro.sync(isLoggedIn = isLoggedIn, isForeground = isForeground)
	}

	fun authenticate(start: suspend () -> Result<Unit>?) {
		if (authBusy) return
		authBusy = true
		authErrorText = null
		scope.launch {
			try {
				authErrorText = signInErrorText(start())
			} finally {
				authBusy = false
			}
		}
	}

	Box(modifier = Modifier.fillMaxSize()) {
		if (isLoggedIn) {
			val listViewModel = remember { createReadingList() }
			val appearance = listViewModel.state.collectAsState().value.appearance
			val listIsDark = AppearancePresentation.isDark(appearance, isSystemInDarkTheme())
			val surface = when {
				introBackdropIsDark -> SystemBarSurface.LAUNCH_INTRO
				listIsDark -> SystemBarSurface.READING_LIST_DARK
				else -> SystemBarSurface.READING_LIST_LIGHT
			}
			SideEffect { applySystemBarIcons(AppearancePresentation.systemBarsNeedLightIcons(surface)) }
			ReadplaceTheme(darkTheme = listIsDark) {
				Surface(modifier = Modifier.fillMaxSize()) {
					ReadingListScreen(
						viewModel = listViewModel,
						now = Instant.now(),
						isForeground = isForeground,
						onSignOut = { scope.launch { session.logout(); intro.replay() } },
						onOpenExternally = onOpenExternally,
					)
				}
			}
		} else {
			val surface = if (introBackdropIsDark) SystemBarSurface.LAUNCH_INTRO else SystemBarSurface.LOGIN
			SideEffect { applySystemBarIcons(AppearancePresentation.systemBarsNeedLightIcons(surface)) }
			LoginScreen(
				rotation = rotation,
				loadSlogans = loadSlogans,
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
