package com.readplace.android.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class UnseenSaveTest {
	@get:Rule
	val temporaryFolder = TemporaryFolder()

	@Test
	fun `a recorded save is visible through a second handle on the same root`() {
		val root = temporaryFolder.newFolder("files")

		UnseenSave(root).record()

		assertTrue(
			"the share target records and the app's list reads, each through its own handle",
			UnseenSave(root).exists,
		)
	}

	@Test
	fun `nothing is recorded until a save lands`() {
		assertFalse(UnseenSave(temporaryFolder.newFolder("files")).exists)
	}

	@Test
	fun `clear takes the recorded save away`() {
		val unseenSave = UnseenSave(temporaryFolder.newFolder("files"))
		unseenSave.record()

		unseenSave.clear()

		assertFalse(unseenSave.exists)
	}

	@Test
	fun `clear with nothing recorded leaves nothing recorded`() {
		val unseenSave = UnseenSave(temporaryFolder.newFolder("files"))

		unseenSave.clear()

		assertFalse(unseenSave.exists)
	}

	@Test
	fun `a second save keeps the one signal`() {
		val unseenSave = UnseenSave(temporaryFolder.newFolder("files"))
		unseenSave.record()

		unseenSave.record()

		assertTrue("presence is the whole signal; a second save adds nothing to it", unseenSave.exists)
	}

	@Test
	fun `records into a root that does not exist yet`() {
		val unseenSave = UnseenSave(File(temporaryFolder.root, "not-yet-created"))

		unseenSave.record()

		assertTrue(unseenSave.exists)
	}

	@Test
	fun `a save that cannot be recorded never fails the share journey`() {
		val unseenSave = UnseenSave(temporaryFolder.newFile("a-file-where-the-root-should-be"))

		unseenSave.record()

		assertFalse("the save itself already succeeded; only the automatic refresh is lost", unseenSave.exists)
	}
}
