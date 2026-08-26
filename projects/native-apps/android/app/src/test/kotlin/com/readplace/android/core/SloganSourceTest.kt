package com.readplace.android.core

import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.junit4.MockWebServerRule
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import java.net.ServerSocket

/**
 * The slogan fetch runs on the sign-in screen, before there is a token and often
 * as the app's first network call. Every failure it can meet has to end as an
 * empty list so the caller's compiled-in slogan stands in — never as a throw the
 * sign-in screen would have to explain.
 */
class SloganSourceTest {
	@get:Rule
	val serverRule = MockWebServerRule()

	private val client = OkHttpClient()

	private val server: MockWebServer get() = serverRule.server

	private fun source(): SloganSource =
		initSloganSource(client, server.url("/").toString().removeSuffix("/"))

	private fun publish(body: String, status: Int = 200, contentType: String = "application/json") {
		server.enqueue(
			MockResponse.Builder()
				.code(status)
				.setHeader("Content-Type", contentType)
				.body(body)
				.build(),
		)
	}

	@Test
	fun `reads the slogans the server published`() = runTest {
		publish("""{"slogans":["Your #1 AI-Powered Reading List.","Paste a link. Read it clean."]}""")

		assertEquals(
			listOf("Your #1 AI-Powered Reading List.", "Paste a link. Read it clean."),
			source().load(),
		)
	}

	@Test
	fun `asks for the slogan path as the android client and without a token`() = runTest {
		publish("""{"slogans":["Your #1 AI-Powered Reading List."]}""")

		source().load()

		val request = server.takeRequest()
		assertEquals("GET", request.method)
		assertEquals(AppConfig.SLOGANS_PATH, request.target)
		assertEquals("application/json", request.headers["Accept"])
		assertEquals(AppConfig.CLIENT_ANDROID, request.headers[AppConfig.CLIENT_HEADER])
		assertNull(
			"sign-in has no token, so the request must not claim one",
			request.headers["Authorization"],
		)
	}

	@Test
	fun `ignores an error status`() = runTest {
		publish("""{"slogans":["Never rendered."]}""", status = 500)

		assertEquals(
			"a 500 body is not a slogan list, whatever it happens to contain",
			emptyList<String>(),
			source().load(),
		)
	}

	@Test
	fun `ignores a body that is not json`() = runTest {
		publish("<html>captive portal</html>", contentType = "text/html")

		assertEquals(
			"a portal or proxy page must not be blind-decoded",
			emptyList<String>(),
			source().load(),
		)
	}

	@Test
	fun `reads a json body served with a charset`() = runTest {
		publish(
			"""{"slogans":["Paste a link. Read it clean."]}""",
			contentType = "application/json; charset=utf-8",
		)

		assertEquals(listOf("Paste a link. Read it clean."), source().load())
	}

	@Test
	fun `ignores a malformed body`() = runTest {
		publish("{not json")

		assertEquals(emptyList<String>(), source().load())
	}

	@Test
	fun `ignores a body that is not a json object`() = runTest {
		publish("""["Your #1 AI-Powered Reading List."]""")

		assertEquals(emptyList<String>(), source().load())
	}

	@Test
	fun `ignores a body missing the slogans field`() = runTest {
		publish("""{"other":[]}""")

		assertEquals(emptyList<String>(), source().load())
	}

	@Test
	fun `ignores a published list holding a value that is not a string`() = runTest {
		publish("""{"slogans":["Your #1 AI-Powered Reading List.",7]}""")

		assertEquals(
			"a number would render as the text \"7\", so the list is not a slogan list",
			emptyList<String>(),
			source().load(),
		)
	}

	@Test
	fun `ignores a published list holding an object`() = runTest {
		publish("""{"slogans":[{"text":"Your #1 AI-Powered Reading List."}]}""")

		assertEquals(emptyList<String>(), source().load())
	}

	@Test
	fun `drops an empty slogan the server published`() = runTest {
		publish("""{"slogans":["Your #1 AI-Powered Reading List.",""]}""")

		assertEquals(
			"an empty slogan would render as a blank line",
			listOf("Your #1 AI-Powered Reading List."),
			source().load(),
		)
	}

	@Test
	fun `ignores a transport failure`() = runTest {
		val slogans = initSloganSource(client, unreachableBaseUrl()).load()

		assertEquals("offline is the common case on a first launch", emptyList<String>(), slogans)
	}

	@Test
	fun `ignores an unusable base url`() = runTest {
		val slogans = initSloganSource(client, "not a url").load()

		assertEquals(emptyList<String>(), slogans)
		assertEquals("an unusable base URL must not reach the network", 0, server.requestCount)
	}

	private fun unreachableBaseUrl(): String =
		ServerSocket(0).use { "http://127.0.0.1:${it.localPort}" }
}
