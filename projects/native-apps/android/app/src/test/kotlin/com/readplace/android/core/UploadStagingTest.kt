package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class UploadStagingTest {
	@get:Rule
	val temporaryFolder = TemporaryFolder()

	private fun stagedUploadBody(name: String): File {
		val directory = File(temporaryFolder.root, "share-uploads")
		directory.mkdirs()
		return File(directory, name).also { it.writeText("<html>hi</html>") }
	}

	@Test
	fun `removes one body by the name the upload task carries`() {
		val staging = UploadStaging(cacheRoot = temporaryFolder.root)
		val released = stagedUploadBody("released.multipart")
		val survivor = stagedUploadBody("survivor.multipart")

		staging.remove(name = released.name)

		assertEquals(
			"only the named body is released",
			listOf(survivor.name),
			File(temporaryFolder.root, "share-uploads").list().orEmpty().toList(),
		)
	}
}
