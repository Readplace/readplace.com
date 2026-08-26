package com.readplace.android.core

import com.readplace.android.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * Central configuration for the Readplace Android app.
 *
 * The app authenticates with its own dedicated public OAuth/PKCE client
 * (`android-app`) registered on the server, and talks to the same Siren API every
 * other Readplace client does. The native `readplace://oauth-callback/android`
 * redirect is registered on that client and is identical across production and
 * staging, so sign-in needs no per-environment callback registration.
 *
 * The server this build targets is fixed at build time via `BuildConfig` — the
 * product flavor decides it, there is no runtime override, and a test pins the
 * active build's selection.
 */
object AppConfig {
	val serverBaseUrl: String = BuildConfig.SERVER_BASE_URL
	val serverHost: String = serverBaseUrl.toHttpUrl().host
	val serverEnvironment: String = BuildConfig.SERVER_ENVIRONMENT

	/** A registered public PKCE client whose allow-listed redirect URIs include the
	 * native redirect the auth flow returns through. */
	const val CLIENT_ID = "android-app"

	const val SIREN_MEDIA_TYPE = "application/vnd.siren+json"

	/** Identifies the native app to the server, which keys onboarding signals, the
	 * discovery cache grant and the save notice off it; a browser on the same phone
	 * can never send it. */
	const val CLIENT_HEADER = "X-Readplace-Client"
	const val CLIENT_ANDROID = "android"

	/** Tells the server this build's saves survive the share sheet, so it drops the
	 * notice asking the user not to close it. The server never advertises the
	 * header: a build that predates the background leg simply never sends it and
	 * keeps the notice, for which it is still true. */
	const val SAVE_CONTINUITY_HEADER = "X-Readplace-Save-Continuity"
	const val SAVE_CONTINUITY_BACKGROUND = "background"

	/** Query item the in-app reader appends to the server `read` link so the reader
	 * renders chromeless — bare of the web shell — with the native reading list as
	 * its chrome. An explicit client-sent signal, never a user-agent sniff. */
	const val PLATFORM_QUERY_NAME = "platform"
	const val PLATFORM_QUERY_VALUE = "android"

	/** Capability marker the app appends to any href it opens in its web sheet: it
	 * tells the server this build hosts the page in a WebView whose navigation
	 * client intercepts `readplace://` deep links, so the server may answer with one.
	 * Always sent together with the platform marker above, which is what lets the
	 * server tell this app's sheet from the iPhone app's. */
	const val APP_SHELL_QUERY_NAME = "shell"
	const val APP_SHELL_QUERY_VALUE = "app"

	/** Custom URL scheme the auth flow redirects to, claimed by MainActivity's
	 * intent filter so the redirect is captured in-process. */
	const val CALLBACK_SCHEME = "readplace"
	const val CALLBACK_HOST = "oauth-callback"

	/** Path segment that separates this app's redirect from the iPhone app's. The
	 * OAuth server matches `redirect_uri` by exact string per client, so without it
	 * a code minted for one app could be redeemed through the other's redirect. */
	const val CALLBACK_PATH = "/android"

	/** Native redirect URI for the Login and Sign up flows, composed from the parts
	 * above rather than repeated as a second literal. Must equal the redirect URI
	 * registered for this client on the server; a test pins the value on both sides. */
	const val NATIVE_CALLBACK_URL = "$CALLBACK_SCHEME://$CALLBACK_HOST$CALLBACK_PATH"

	/** The public privacy policy served by the web app, linked from the sign-in
	 * screen so the policy is reachable in-app. */
	val privacyPolicyUrl: String get() = "$serverBaseUrl/privacy"

	/** Path of the server's "add links via Share" help page, opened by the reading
	 * list's client-side add (+) control. The page is a real server route, but the
	 * client holds the path itself so the control works without the server
	 * advertising it as a Siren link. */
	const val ADD_LINKS_HELP_PATH = "/help/add-links"

	/** Path of the server's slogan list, rendered on the sign-in screen. Held by the
	 * client rather than discovered, because sign-in is the one screen that runs
	 * before there is a session to walk the Siren entry point with. */
	const val SLOGANS_PATH = "/slogans"

	/** Shown until the fetched list arrives, and kept if it never does. Sign-in is
	 * the app's first screen and often its first network call, so the slogan cannot
	 * depend on that call succeeding. */
	const val FALLBACK_SLOGAN = "The #1 Personal Reading List."

	/** A stock Chrome-on-Android user agent for the WebViews. Android's own WebView
	 * UA carries a `; wv` token that some sites degrade or refuse, and the capture
	 * WebView needs sites to serve their normal page. This is the one place the
	 * Android port deliberately differs from iOS, which sends a Safari UA for the
	 * same reason. */
	const val WEB_VIEW_USER_AGENT =
		"Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
			"Chrome/140.0.0.0 Mobile Safari/537.36"

	/** The identifiable User-Agent every native request sends. OkHttp's default
	 * (`okhttp/x.y.z`) identifies nothing, and the server's analytics keys the
	 * device class and the bot exemption off this exact shape. */
	fun nativeUserAgent(versionCode: Int, osRelease: String): String =
		"Readplace/$versionCode Android/$osRelease"
}
