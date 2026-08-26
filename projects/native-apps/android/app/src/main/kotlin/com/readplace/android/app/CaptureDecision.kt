package com.readplace.android.app

import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * What the capture WebView does with a navigation response, decided from the
 * main-frame resource's media type before choosing whether to render it. A PDF is
 * cancelled rather than loaded — a large PDF would blow the share target's memory
 * budget — and finished as a non-extract capture so the save journey fetches the
 * bytes itself and uploads them as a file. Only a main-frame PDF is captured as a
 * file: a PDF loaded into a subframe must not cancel the whole page or overwrite
 * the page's own media type. Kept apart from the WebView so the decision is a
 * pure value the tests exercise directly.
 */
sealed interface CaptureDecision {
	data class Allow(val detectedMediaType: String?) : CaptureDecision

	data class CaptureAsFile(val mediaType: String) : CaptureDecision

	companion object {
		/** A capture resolves on first main-frame load completion, after this short
		 * settle delay so script-rendered content is present. */
		val SETTLE_DELAY: Duration = 400.milliseconds

		/** The production timeout the orchestrator-facing capture is pinned to: the
		 * capture resolves with whatever the page holds when it elapses, whichever of
		 * the two comes first. */
		val TIMEOUT: Duration = 12.seconds

		private const val PDF_MEDIA_TYPE = "application/pdf"

		fun forNavigationResponse(mimeType: String?, isMainFrame: Boolean): CaptureDecision {
			if (!isMainFrame) return Allow(detectedMediaType = null)
			if (mimeType == PDF_MEDIA_TYPE) return CaptureAsFile(mediaType = PDF_MEDIA_TYPE)
			return Allow(detectedMediaType = mimeType)
		}
	}
}
