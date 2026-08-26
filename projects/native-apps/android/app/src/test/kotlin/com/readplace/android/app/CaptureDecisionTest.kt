package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

class CaptureDecisionTest {
	@Test
	fun `a main-frame pdf is captured as a file`() {
		assertEquals(
			CaptureDecision.CaptureAsFile(mediaType = "application/pdf"),
			CaptureDecision.forNavigationResponse(mimeType = "application/pdf", isMainFrame = true),
		)
	}

	@Test
	fun `main-frame html is allowed and stamps its media type`() {
		assertEquals(
			CaptureDecision.Allow(detectedMediaType = "text/html"),
			CaptureDecision.forNavigationResponse(mimeType = "text/html", isMainFrame = true),
		)
	}

	@Test
	fun `a subframe pdf is allowed and stamps nothing`() {
		// Only a main-frame PDF is captured as a file; a PDF loaded into a subframe
		// must not cancel the whole page or overwrite the page's own media type.
		assertEquals(
			CaptureDecision.Allow(detectedMediaType = null),
			CaptureDecision.forNavigationResponse(mimeType = "application/pdf", isMainFrame = false),
		)
	}

	@Test
	fun `a main frame without a media type is allowed`() {
		assertEquals(
			CaptureDecision.Allow(detectedMediaType = null),
			CaptureDecision.forNavigationResponse(mimeType = null, isMainFrame = true),
		)
	}

	@Test
	fun `a capture settles briefly after the load and is bounded by the production timeout`() {
		assertEquals(400.milliseconds, CaptureDecision.SETTLE_DELAY)
		assertEquals(12.seconds, CaptureDecision.TIMEOUT)
	}
}
