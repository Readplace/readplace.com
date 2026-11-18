package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.coroutines.cancellation.CancellationException

class OfflineReadingTest {
	@Test
	fun `only a failure to reach the network counts as offline`() {
		val failures = listOf(
			UnknownHostException("x"),
			ConnectException("x"),
			SocketTimeoutException("x"),
			ApiError.Server(500, code = null, serverMessage = null),
			ApiError.Unauthorized(),
			ApiError.NoToken(),
			ApiError.Decoding(),
			OAuthError.RefreshFailed(),
			CancellationException(),
		)

		assertEquals(
			listOf(true, true, true, false, false, false, false, false, false),
			failures.map { OfflineReading.isTransportFailure(it) },
		)
	}
}
