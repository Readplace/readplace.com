package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppConfigTest {
	private val baseUrlByFlavor = mapOf(
		"production" to "https://readplace.com",
		"staging" to "https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com",
		"local" to "http://localhost:3000",
	)

	private fun baseUrlOfTheFlavorUnderTest(): String {
		val environment = AppConfig.serverEnvironment
		val expected = baseUrlByFlavor[environment]
		assertTrue(
			"SERVER_ENVIRONMENT must name one of the product flavors, was: $environment",
			expected != null,
		)
		return expected.orEmpty()
	}

	@Test
	fun `points at the stack its build flavor selected`() {
		assertEquals(baseUrlOfTheFlavorUnderTest(), AppConfig.serverBaseUrl)
	}

	@Test
	fun `privacy policy is the privacy page on the stack this build targets`() {
		assertEquals("${baseUrlOfTheFlavorUnderTest()}/privacy", AppConfig.privacyPolicyUrl)
	}

	@Test
	fun `oauth client id is the public pkce client registered on the server`() {
		assertEquals("android-app", AppConfig.CLIENT_ID)
	}

	@Test
	fun `native callback url is the redirect registered for the android client`() {
		assertEquals("readplace://oauth-callback/android", AppConfig.NATIVE_CALLBACK_URL)
	}

	@Test
	fun `native callback url is composed from its scheme host and path`() {
		assertEquals("readplace", AppConfig.CALLBACK_SCHEME)
		assertEquals("oauth-callback", AppConfig.CALLBACK_HOST)
		assertEquals("/android", AppConfig.CALLBACK_PATH)
		assertEquals(
			"${AppConfig.CALLBACK_SCHEME}://${AppConfig.CALLBACK_HOST}${AppConfig.CALLBACK_PATH}",
			AppConfig.NATIVE_CALLBACK_URL,
		)
	}

	@Test
	fun `callback path separates this app's redirect from the iPhone app's`() {
		val iPhoneRedirect = "readplace://oauth-callback"
		assertEquals(iPhoneRedirect + AppConfig.CALLBACK_PATH, AppConfig.NATIVE_CALLBACK_URL)
		assertNotEquals(iPhoneRedirect, AppConfig.NATIVE_CALLBACK_URL)
	}

	@Test
	fun `client header identifies the native app to the server`() {
		assertEquals("X-Readplace-Client", AppConfig.CLIENT_HEADER)
		assertEquals("android", AppConfig.CLIENT_ANDROID)
	}

	@Test
	fun `siren media type is the one the api answers with`() {
		assertEquals("application/vnd.siren+json", AppConfig.SIREN_MEDIA_TYPE)
	}

	@Test
	fun `save continuity header tells the server the save survives the share sheet`() {
		assertEquals("X-Readplace-Save-Continuity", AppConfig.SAVE_CONTINUITY_HEADER)
		assertEquals("background", AppConfig.SAVE_CONTINUITY_BACKGROUND)
	}

	@Test
	fun `platform query item is the marker that renders the reader chromeless`() {
		assertEquals("platform", AppConfig.PLATFORM_QUERY_NAME)
		assertEquals("android", AppConfig.PLATFORM_QUERY_VALUE)
	}

	@Test
	fun `app shell query item is the marker the server gates deep links on`() {
		assertEquals("shell", AppConfig.APP_SHELL_QUERY_NAME)
		assertEquals("app", AppConfig.APP_SHELL_QUERY_VALUE)
	}

	@Test
	fun `add links help path is the server's share help page`() {
		assertEquals("/help/add-links", AppConfig.ADD_LINKS_HELP_PATH)
	}

	@Test
	fun `slogans path is the server's slogan list`() {
		assertEquals("/slogans", AppConfig.SLOGANS_PATH)
	}

	@Test
	fun `fallback slogan stands in until the fetched list arrives`() {
		assertEquals("The #1 Personal Reading List.", AppConfig.FALLBACK_SLOGAN)
	}

	@Test
	fun `web view user agent is a stock chrome on android`() {
		assertEquals(
			"Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
				"Chrome/140.0.0.0 Mobile Safari/537.36",
			AppConfig.WEB_VIEW_USER_AGENT,
		)
		assertFalse(
			"the WebView UA must not carry the wv token sites degrade on",
			AppConfig.WEB_VIEW_USER_AGENT.contains("; wv"),
		)
	}

	@Test
	fun `native user agent names the build and the os release`() {
		assertEquals(
			"Readplace/42 Android/16",
			AppConfig.nativeUserAgent(versionCode = 42, osRelease = "16"),
		)
	}

	@Test
	fun `native user agent carries whichever build and release it is handed`() {
		assertEquals(
			"Readplace/1 Android/14",
			AppConfig.nativeUserAgent(versionCode = 1, osRelease = "14"),
		)
	}
}
