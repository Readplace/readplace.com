package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test

class OfflineDownloadTest {
	@Test
	fun `a run that has found nothing yet says it is finding unread articles`() {
		val progress = OfflineDownloadProgress(completed = 0, total = 0)

		assertEquals("Finding unread articles…" to 0f, progress.label to progress.fraction)
	}

	@Test
	fun `a run with articles queued counts them for offline reading`() {
		val progress = OfflineDownloadProgress(completed = 3, total = 20)

		assertEquals("Downloading 3 of 20 for offline reading" to 0.15f, progress.label to progress.fraction)
	}

	@Test
	fun `a run where every article was stored has no failure to report`() {
		assertEquals(null, OfflineDownloadProgress(completed = 4, total = 4).failureText)
	}

	@Test
	fun `a run with articles that were not stored says how many of the total failed`() {
		val progress = OfflineDownloadProgress(completed = 4, total = 4, failed = 2)

		assertEquals("2 of 4 articles couldn't be downloaded for offline reading", progress.failureText)
	}
}
