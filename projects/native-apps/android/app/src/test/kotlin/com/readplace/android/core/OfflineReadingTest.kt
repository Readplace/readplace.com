package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import kotlin.coroutines.cancellation.CancellationException

class OfflineReadingTest {
	@Test
	fun `only a failure to reach the network counts as offline`() {
		val failures = listOf(
			UnknownHostException("x"),
			ConnectException("x"),
			SocketTimeoutException("x"),
			SSLException("x"),
			IOException("x"),
			ApiError.Server(500, code = null, serverMessage = null),
			ApiError.Unauthorized(),
			ApiError.NoToken(),
			ApiError.Decoding(),
			OAuthError.RefreshFailed(),
			CancellationException(),
		)

		assertEquals(
			listOf(true, true, true, true, true, false, false, false, false, false, false),
			failures.map { OfflineReading.isTransportFailure(it) },
		)
	}

	@Test
	fun `the banner sentence is the iOS sentence`() {
		assertEquals(
			"Your internet is not working, your reading is offline. Readplace is read-only until you're back online.",
			OfflineReading.BANNER_TEXT,
		)
	}

	@Test
	fun `the empty-list sentence is the iOS sentence`() {
		assertEquals(
			"You're offline. Your reading list will appear once you're back online.",
			OfflineReading.EMPTY_LIST_TEXT,
		)
	}
}
