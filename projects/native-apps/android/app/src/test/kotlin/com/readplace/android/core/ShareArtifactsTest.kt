package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ShareArtifactsTest {
	@get:Rule
	val temporaryFolder = TemporaryFolder()

	private class RecordingUploadQueue : PurgeableUploadQueue {
		var purges = 0

		override fun purgeAll() {
			purges += 1
		}
	}

	@Test
	fun `takes the queued uploads, the unseen save and the cached discovery with the session`() {
		val jobs = RecordingUploadQueue()
		val unseenSave = UnseenSave(temporaryFolder.newFolder("files"))
		unseenSave.record()
		assertTrue("precondition: a save is recorded", unseenSave.exists)
		val discoveryCache = DiscoveryHttpCache(temporaryFolder.newFolder("cache"))
		discoveryCache.cache.directory.mkdirs()
		val entry = File(discoveryCache.cache.directory, "entry")
		entry.writeText("a cached queue response")

		ShareArtifacts(jobs, unseenSave, discoveryCache).purge()

		assertEquals(1, jobs.purges)
		assertFalse(
			"a save recorded for one account must not make the next account's list refresh",
			unseenSave.exists,
		)
		assertFalse(entry.exists())
	}
}
