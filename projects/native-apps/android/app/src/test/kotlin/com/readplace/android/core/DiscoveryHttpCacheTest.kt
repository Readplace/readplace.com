package com.readplace.android.core

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.junit4.MockWebServerRule
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DiscoveryHttpCacheTest {
	@get:Rule
	val temporaryFolder = TemporaryFolder()

	@get:Rule
	val serverRule = MockWebServerRule()

	private val server: MockWebServer get() = serverRule.server

	private fun publish(body: String) {
		server.enqueue(
			MockResponse.Builder()
				.code(200)
				.setHeader("Cache-Control", "max-age=60")
				.body(body)
				.build(),
		)
	}

	private fun discover(client: OkHttpClient): String =
		client.newCall(Request.Builder().url(server.url("/queue")).build())
			.execute()
			.use { it.body.string() }

	@Test
	fun `builds a 10 MiB disk cache inside the cache root`() {
		val discovery = DiscoveryHttpCache(temporaryFolder.root)

		assertEquals(10L * 1024 * 1024, discovery.cache.maxSize())
		assertEquals(File(temporaryFolder.root, "discovery-http-cache"), discovery.cache.directory)
	}

	@Test
	fun `serves a repeat discovery from disk for as long as the server allowed`() {
		val client = OkHttpClient.Builder().cache(DiscoveryHttpCache(temporaryFolder.root).cache).build()
		publish("the readlist")

		assertEquals("the readlist", discover(client))
		assertEquals("the readlist", discover(client))

		assertEquals("the server defines the lifetime, not the client", 1, server.requestCount)
	}

	@Test
	fun `purge removes the cache directory`() {
		val discovery = DiscoveryHttpCache(temporaryFolder.root)
		val directory = File(temporaryFolder.root, "discovery-http-cache")
		directory.mkdirs()
		File(directory, "entry").writeText("cached")

		discovery.purge()

		assertFalse(directory.exists())
	}

	@Test
	fun `purge forgets a discovery the cache had been serving`() {
		val discovery = DiscoveryHttpCache(temporaryFolder.root)
		val client = OkHttpClient.Builder().cache(discovery.cache).build()
		publish("readlist for account A")
		assertEquals("readlist for account A", discover(client))
		assertEquals("readlist for account A", discover(client))
		assertEquals("precondition: the cache is serving the response", 1, server.requestCount)

		discovery.purge()

		publish("readlist for account B")
		assertEquals(
			"a readlist cached for one account must not be served to the next",
			"readlist for account B",
			discover(client),
		)
		assertEquals(2, server.requestCount)
	}
}
