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

	private companion object {
		const val ERROR_UNKNOWN = -1
		const val ERROR_HOST_LOOKUP = -2
		const val ERROR_CONNECT = -6
		const val ERROR_TIMEOUT = -8
	}
}
