package com.readplace.android.core

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.junit4.MockWebServerRule
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import java.io.IOException

class NativeCleartextPolicyTest {
	@get:Rule
	val serverRule = MockWebServerRule()

	private val server: MockWebServer get() = serverRule.server

	private val production = NativeCleartextPolicy.forEnvironment("production")
	private val local = NativeCleartextPolicy.forEnvironment("local")

	// region the decision

	@Test
	fun `https is allowed on any host, whatever the flavor permits for cleartext`() {
		assertFalse(production.forbids("https", "readplace.com"))
		assertFalse(local.forbids("https", "example.org"))
	}

	@Test
	fun `production and staging permit no cleartext host at all`() {
		for (host in listOf("localhost", "127.0.0.1", "10.0.2.2", "readplace.com")) {
			assertTrue("production must forbid cleartext to $host", production.forbids("http", host))
			assertTrue(
				"staging must forbid cleartext to $host",
				NativeCleartextPolicy.forEnvironment("staging").forbids("http", host),
			)
		}
	}

	@Test
	fun `local permits cleartext only to the loopback dev hosts`() {
		for (host in listOf("localhost", "127.0.0.1", "10.0.2.2")) {
			assertFalse("local must permit cleartext to the dev host $host", local.forbids("http", host))
		}
		assertTrue("local must still forbid cleartext to an arbitrary host", local.forbids("http", "evil.example"))
	}

	// endregion

	// region the interceptor

	@Test
	fun `a permitted request is sent and its response returned`() {
		server.enqueue(MockResponse(code = 200, body = "ok"))
		val client = OkHttpClient.Builder()
			.addNetworkInterceptor(NativeCleartextPolicy(setOf(server.url("/").host)))
			.build()

		client.newCall(Request.Builder().url(server.url("/thing")).build()).execute().use { response ->
			assertEquals(200, response.code)
			assertEquals("ok", response.body.string())
		}
		assertEquals(1, server.requestCount)
	}

	@Test
	fun `a forbidden cleartext request is refused before it reaches the server`() {
		val client = OkHttpClient.Builder().addNetworkInterceptor(production).build()

		try {
			client.newCall(Request.Builder().url(server.url("/thing")).build()).execute()
			fail("a cleartext request under the production policy must not be sent")
		} catch (error: IOException) {
			assertTrue(
				"the refusal must be the policy's, not a transport failure",
				error.message.orEmpty().contains("not permitted for native requests"),
			)
		}
		assertEquals("the server must never receive the refused request", 0, server.requestCount)
	}

	// endregion
}
