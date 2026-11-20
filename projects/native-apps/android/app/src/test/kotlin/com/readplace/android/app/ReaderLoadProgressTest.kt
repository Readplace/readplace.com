package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderLoadProgressTest {
	// region rendering(estimatedProgress)

	@Test
	fun `rendering wraps the estimated progress`() {
		assertEquals(ReaderLoadPhase.Rendering(0.7), ReaderLoad.rendering(estimatedProgress = 0.7))
	}

	@Test
	fun `rendering clamps progress below zero`() {
		assertEquals(ReaderLoadPhase.Rendering(0.0), ReaderLoad.rendering(estimatedProgress = -0.5))
	}

	@Test
	fun `rendering clamps progress above one`() {
		assertEquals(ReaderLoadPhase.Rendering(1.0), ReaderLoad.rendering(estimatedProgress = 1.5))
	}

	// endregion

	// region overlay(phase)

	@Test
	fun `loading overlay shows the skeleton and the head start bar`() {
		assertEquals(
			ReaderLoadOverlay(showsSkeleton = true, showsProgressBar = true, progress = 0.1),
			ReaderLoad.overlay(ReaderLoadPhase.Loading),
		)
	}

	@Test
	fun `rendering overlay shows the bar without the skeleton`() {
		assertEquals(
			ReaderLoadOverlay(showsSkeleton = false, showsProgressBar = true, progress = 0.7),
			ReaderLoad.overlay(ReaderLoadPhase.Rendering(0.7)),
		)
	}

	@Test
	fun `rendering overlay never regresses below the head start`() {
		assertEquals(0.1, ReaderLoad.overlay(ReaderLoadPhase.Rendering(0.02)).progress, 0.0)
	}

	@Test
	fun `the skeleton covers the page only until the main frame commits`() {
		assertTrue(ReaderLoad.overlay(ReaderLoadPhase.Loading).showsSkeleton)
		assertFalse(ReaderLoad.overlay(ReaderLoadPhase.Rendering(0.5)).showsSkeleton)
	}

	@Test
	fun `the bar shows only while the load is still in flight`() {
		assertTrue(ReaderLoad.overlay(ReaderLoadPhase.Loading).showsProgressBar)
		assertTrue(ReaderLoad.overlay(ReaderLoadPhase.Rendering(0.5)).showsProgressBar)
		assertFalse(ReaderLoad.overlay(ReaderLoadPhase.Finished).showsProgressBar)
		assertFalse(ReaderLoad.overlay(ReaderLoadPhase.Failed).showsProgressBar)
	}

	@Test
	fun `finished overlay hides everything at full`() {
		assertEquals(
			ReaderLoadOverlay(showsSkeleton = false, showsProgressBar = false, progress = 1.0),
			ReaderLoad.overlay(ReaderLoadPhase.Finished),
		)
	}

	@Test
	fun `failed overlay hides everything at full`() {
		assertEquals(
			ReaderLoadOverlay(showsSkeleton = false, showsProgressBar = false, progress = 1.0),
			ReaderLoad.overlay(ReaderLoadPhase.Failed),
		)
	}

	// endregion

	// region isRealFailure(errorCode)

	@Test
	fun `an aborted navigation is not a real failure`() {
		assertFalse(ReaderLoad.isRealFailure(errorCode = ERROR_UNKNOWN))
	}

	@Test
	fun `a timeout is a real failure`() {
		assertTrue(ReaderLoad.isRealFailure(errorCode = ERROR_TIMEOUT))
	}

	@Test
	fun `a connect failure is a real failure`() {
		assertTrue(ReaderLoad.isRealFailure(errorCode = ERROR_CONNECT))
	}

	@Test
	fun `a host lookup failure is a real failure`() {
		assertTrue(ReaderLoad.isRealFailure(errorCode = ERROR_HOST_LOOKUP))
	}

	@Test
	fun `a failure reported without an error code is a real failure`() {
		assertTrue(ReaderLoad.isRealFailure(errorCode = null))
	}

	// endregion

	@Test
	fun `only a finished online load confirms a stored copy`() {
		val phases = listOf(
			ReaderLoadPhase.Loading,
			ReaderLoadPhase.Rendering(progress = 0.5),
			ReaderLoadPhase.Finished,
			ReaderLoadPhase.Failed,
		)

		val answers = phases.flatMap { phase ->
			listOf(ReaderCacheMode.PROTOCOL, ReaderCacheMode.STORED_COPY_FIRST).map { cacheMode ->
				ReaderLoad.confirmsStoredCopy(phase = phase, cacheMode = cacheMode)
			}
		}

		assertEquals(
			"a stored copy read back offline is not the server's answer, so reading it never makes it younger",
			listOf(false, false, false, false, true, false, false, false),
			answers,
		)
	}

	@Test
	fun `a load that cannot reach the network reopens from the stored copy`() {
		assertEquals(
			List(4) { ReaderFailureRecovery.REOPEN_FROM_STORED_COPY },
			listOf(ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_IO, ERROR_TIMEOUT).map {
				ReaderLoad.recovery(errorCode = it, cacheMode = ReaderCacheMode.PROTOCOL)
			},
		)
	}

	@Test
	fun `a view already reading the stored copy never reopens`() {
		assertEquals(
			List(4) { ReaderFailureRecovery.FAIL },
			listOf(ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_IO, ERROR_TIMEOUT).map {
				ReaderLoad.recovery(errorCode = it, cacheMode = ReaderCacheMode.STORED_COPY_FIRST)
			},
		)
	}

	@Test
	fun `an HTTP error status fails`() {
		assertEquals(
			ReaderFailureRecovery.FAIL,
			ReaderLoad.recovery(errorCode = null, cacheMode = ReaderCacheMode.PROTOCOL),
		)
	}

	@Test
	fun `a failure that is not the network fails`() {
		assertEquals(
			List(7) { ReaderFailureRecovery.FAIL },
			listOf(
				ERROR_FAILED_SSL_HANDSHAKE,
				ERROR_PROXY_AUTHENTICATION,
				ERROR_REDIRECT_LOOP,
				ERROR_BAD_URL,
				ERROR_TOO_MANY_REQUESTS,
				ERROR_UNSAFE_RESOURCE,
				ERROR_UNKNOWN,
			).map { ReaderLoad.recovery(errorCode = it, cacheMode = ReaderCacheMode.PROTOCOL) },
		)
	}

	private companion object {
		const val ERROR_UNKNOWN = -1
		const val ERROR_HOST_LOOKUP = -2
		const val ERROR_PROXY_AUTHENTICATION = -5
		const val ERROR_CONNECT = -6
		const val ERROR_IO = -7
		const val ERROR_TIMEOUT = -8
		const val ERROR_REDIRECT_LOOP = -9
		const val ERROR_FAILED_SSL_HANDSHAKE = -11
		const val ERROR_BAD_URL = -12
		const val ERROR_TOO_MANY_REQUESTS = -15
		const val ERROR_UNSAFE_RESOURCE = -16
	}
}
