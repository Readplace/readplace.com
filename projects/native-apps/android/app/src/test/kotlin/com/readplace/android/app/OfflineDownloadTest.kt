package com.readplace.android.app

import com.readplace.android.core.OfflineDownloadRun
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
	fun `a running download offers cancel and no continue`() {
		val status = OfflineDownloadStatus.Running(OfflineDownloadProgress(completed = 3, total = 20))

		assertEquals(
			listOf("Downloading 3 of 20 for offline reading", 0.15f, "Cancel download", false),
			listOf(status.label, status.fraction, status.dismissLabel, status.offersContinue),
		)
	}

	@Test
	fun `an interrupted run says how far it got and offers continue or dismiss`() {
		val run = OfflineDownloadRun(total = 1296, completed = 312)
		val status = OfflineDownloadStatus.Resumable(run)

		assertEquals(
			listOf("312 of 1296 downloaded for offline reading", 312f / 1296f, "Dismiss download", true, true),
			listOf(status.label, status.fraction, status.dismissLabel, status.offersContinue, run.isIncomplete),
		)
	}

	@Test
	fun `an empty run has no fraction and is not interrupted`() {
		val run = OfflineDownloadRun(total = 0, completed = 0)

		assertEquals(0f to false, OfflineDownloadStatus.Resumable(run).fraction to run.isIncomplete)
	}

	@Test
	fun `a run with failures names how many articles were not stored`() {
		val outcomes = listOf(OfflineDownloadOutcome.of(failed = 0, total = 3), OfflineDownloadOutcome.of(failed = 1, total = 3))

		assertEquals(
			listOf(OfflineDownloadOutcome.Downloaded, OfflineDownloadOutcome.PartiallyDownloaded(failed = 1, total = 3)),
			outcomes,
		)
		assertEquals(
			listOf(null, "1 of 3 articles couldn't be downloaded for offline reading"),
			outcomes.map { it.failureText },
		)
	}
}
