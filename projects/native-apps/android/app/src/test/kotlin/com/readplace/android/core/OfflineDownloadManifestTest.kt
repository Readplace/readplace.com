package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.coroutines.CoroutineContext

class OfflineDownloadManifestTest {
	@get:Rule
	val folder = TemporaryFolder()

	private fun TestScope.manifest(directory: File): OfflineDownloadManifest =
		OfflineDownloadManifest(directory, StandardTestDispatcher(testScheduler))

	private fun manifestFile(directory: File): File = File(directory, "download-manifest.json")

	private fun assertFileHolds(directory: File, expected: String) {
		assertEquals(Json.parseToJsonElement(expected), Json.parseToJsonElement(manifestFile(directory).readText()))
	}

	@Test
	fun `a recorded run is offered by a second store on the same directory`() = runTest {
		val directory = folder.newFolder()

		manifest(directory).recordRun(OfflineDownloadRun(total = 1296, completed = 312))

		assertEquals(OfflineDownloadRun(total = 1296, completed = 312), manifest(directory).incompleteRun())
	}

	@Test
	fun `only a run that stopped short is offered`() = runTest {
		val directory = folder.newFolder()
		val manifest = manifest(directory)
		val nothingRecorded = manifest.incompleteRun()
		manifest.recordRun(OfflineDownloadRun(total = 2, completed = 1))
		val stoppedShort = manifest.incompleteRun()

		manifest.recordRun(OfflineDownloadRun(total = 2, completed = 2))

		assertEquals(
			listOf(null, OfflineDownloadRun(total = 2, completed = 1), null),
			listOf(nothingRecorded, stoppedShort, manifest.incompleteRun()),
		)
		assertFileHolds(directory, """{"run":{"total":2,"completed":2}}""")
		manifest.forgetRun()
		assertFileHolds(directory, """{"run":null}""")
	}

	@Test
	fun `a corrupt file offers nothing until a run is recorded`() = runTest {
		val directory = folder.newFolder().also { manifestFile(it).writeText("{") }
		val manifest = manifest(directory)
		val corrupt = manifest.incompleteRun()

		manifest.recordRun(OfflineDownloadRun(total = 2, completed = 1))

		assertEquals(listOf(null, OfflineDownloadRun(total = 2, completed = 1)), listOf(corrupt, manifest.incompleteRun()))
	}

	@Test
	fun `a file holding only a run offers it`() = runTest {
		val directory = folder.newFolder().also { manifestFile(it).writeText("""{"run":{"total":5,"completed":1}}""") }

		assertEquals(OfflineDownloadRun(total = 5, completed = 1), manifest(directory).incompleteRun())
	}

	@Test
	fun `a deleted directory offers no run`() = runTest {
		val directory = folder.newFolder()
		val manifest = manifest(directory)
		manifest.recordRun(OfflineDownloadRun(total = 2, completed = 1))
		val beforeSignOut = manifest.incompleteRun()

		directory.deleteRecursively()

		assertEquals(listOf(OfflineDownloadRun(total = 2, completed = 1), null), listOf(beforeSignOut, manifest.incompleteRun()))
	}

	@Test
	fun `a run that cannot be written never fails the download`() = runTest {
		val root = folder.newFile("a-file-where-the-directory-should-be")
		val manifest = manifest(root)

		val recorded = manifest.recordRun(OfflineDownloadRun(total = 2, completed = 1))

		assertEquals(Unit to null, recorded to manifest.incompleteRun())
	}

	@Test
	fun `runs recorded back to back land in the order they were made`() = runTest {
		val directory = folder.newFolder()
		val io = HeldDispatcher()
		val writer = OfflineDownloadManifest(directory, io)

		launch { writer.recordRun(OfflineDownloadRun(total = 3, completed = 1)) }
		launch { writer.recordRun(OfflineDownloadRun(total = 3, completed = 2)) }
		runCurrent()
		while (io.held.isNotEmpty()) {
			val blocks = io.held.reversed()
			io.held.clear()
			blocks.forEach { it.run() }
			runCurrent()
		}

		assertEquals(OfflineDownloadRun(total = 3, completed = 2), manifest(directory).incompleteRun())
	}

	@Test
	fun `a file left with download versions still offers its run, and the next write drops them`() = runTest {
		val directory = folder.newFolder().also { manifestFile(it).writeText("""{"versions":{"a1":"v3"},"run":{"total":2,"completed":1}}""") }
		val manifest = manifest(directory)
		val offered = manifest.incompleteRun()

		manifest.forgetRun()

		assertEquals(OfflineDownloadRun(total = 2, completed = 1), offered)
		assertFileHolds(directory, """{"run":null}""")
	}
	private class HeldDispatcher : CoroutineDispatcher() {
		val held = mutableListOf<Runnable>()

		override fun dispatch(context: CoroutineContext, block: Runnable) {
			held.add(block)
		}
	}
}
