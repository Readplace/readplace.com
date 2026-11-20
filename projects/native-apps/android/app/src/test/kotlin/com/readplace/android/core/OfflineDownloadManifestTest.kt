package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
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

	private suspend fun TestScope.loaded(directory: File): DownloadedVersions {
		val manifest = manifest(directory)
		manifest.load()
		return manifest.versions.value
	}

	private fun manifestFile(directory: File): File = File(directory, "download-manifest.json")

	private fun assertFileHolds(directory: File, expected: String) {
		assertEquals(Json.parseToJsonElement(expected), Json.parseToJsonElement(manifestFile(directory).readText()))
	}

	@Test
	fun `a copy is current only for the article and version recorded`() {
		val versions = DownloadedVersions(mapOf("a1" to "v1"))

		assertEquals(
			listOf(true, false, false, false),
			listOf(
				versions.isCurrent(articleId = "a1", contentVersion = "v1"),
				versions.isCurrent(articleId = "a1", contentVersion = "v2"),
				versions.isCurrent(articleId = "a2", contentVersion = "v1"),
				versions.isCurrent(articleId = "a1", contentVersion = null),
			),
		)
	}

	@Test
	fun `a recorded version is published by a second store on the same directory`() = runTest {
		val directory = folder.newFolder()

		manifest(directory).recordDownloaded(articleId = "a1", contentVersion = "v1")

		assertEquals(DownloadedVersions(mapOf("a1" to "v1")), loaded(directory))
	}

	@Test
	fun `a missing or unreadable file loads empty, and a valid one loads its entries`() = runTest {
		val missing = folder.newFolder()
		val corrupt = folder.newFolder().also { manifestFile(it).writeText("{") }
		val valid = folder.newFolder().also { manifestFile(it).writeText("""{"versions":{"a1":"v1"}}""") }

		assertEquals(
			listOf(
				DownloadedVersions(emptyMap()),
				DownloadedVersions(emptyMap()),
				DownloadedVersions(mapOf("a1" to "v1")),
			),
			listOf(loaded(missing), loaded(corrupt), loaded(valid)),
		)
	}

	@Test
	fun `a version write keeps the run another writer stored`() = runTest {
		val directory = folder.newFolder()
		manifestFile(directory).writeText("""{"run":{"total":5,"completed":2}}""")
		val manifest = manifest(directory)

		manifest.load()
		manifest.recordDownloaded(articleId = "a1", contentVersion = "v1")

		assertFileHolds(directory, """{"versions":{"a1":"v1"},"run":{"total":5,"completed":2}}""")
	}

	@Test
	fun `a null run loads the versions beside it`() = runTest {
		val directory = folder.newFolder()
		manifestFile(directory).writeText("""{"versions":{"a1":"v1"},"run":null}""")

		assertEquals(DownloadedVersions(mapOf("a1" to "v1")), loaded(directory))
	}

	@Test
	fun `a newer version replaces the one recorded before it`() = runTest {
		val manifest = manifest(folder.newFolder())

		manifest.recordDownloaded(articleId = "a1", contentVersion = "v1")
		manifest.recordDownloaded(articleId = "a1", contentVersion = "v2")

		assertEquals(DownloadedVersions(mapOf("a1" to "v2")), manifest.versions.value)
	}

	@Test
	fun `records made at the same time all reach the file`() = runTest {
		val directory = folder.newFolder()
		val manifest = manifest(directory)

		listOf("a1", "a2", "a3", "a4").forEach { id ->
			launch { manifest.recordDownloaded(articleId = id, contentVersion = "v1") }
		}
		advanceUntilIdle()

		assertEquals(
			DownloadedVersions(mapOf("a1" to "v1", "a2" to "v1", "a3" to "v1", "a4" to "v1")),
			loaded(directory),
		)
	}

	@Test
	fun `a deleted directory clears what the store publishes and what it writes next`() = runTest {
		val directory = folder.newFolder()
		val manifest = manifest(directory)
		manifest.recordDownloaded(articleId = "a1", contentVersion = "v1")

		directory.deleteRecursively()
		manifest.load()
		val afterSignOut = manifest.versions.value
		manifest.recordDownloaded(articleId = "b1", contentVersion = "v1")

		assertEquals(
			listOf(DownloadedVersions(emptyMap()), DownloadedVersions(mapOf("b1" to "v1"))),
			listOf(afterSignOut, loaded(directory)),
		)
	}

	@Test
	fun `a write reads the run on disk, not the one seen at load`() = runTest {
		val directory = folder.newFolder()
		manifestFile(directory).writeText("""{"versions":{},"run":{"total":5,"completed":1}}""")
		val manifest = manifest(directory)
		manifest.load()

		manifestFile(directory).writeText("""{"versions":{},"run":{"total":5,"completed":3}}""")
		manifest.recordDownloaded(articleId = "a1", contentVersion = "v1")

		assertFileHolds(directory, """{"versions":{"a1":"v1"},"run":{"total":5,"completed":3}}""")
	}

	@Test
	fun `a record that cannot be written never fails the download`() = runTest {
		val root = folder.newFile("a-file-where-the-root-should-be")

		manifest(root).recordDownloaded(articleId = "a1", contentVersion = "v1")

		assertEquals(DownloadedVersions(emptyMap()), loaded(root))
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
		assertFileHolds(directory, """{"versions":{},"run":{"total":2,"completed":2}}""")
		manifest.forgetRun()
		assertFileHolds(directory, """{"versions":{},"run":null}""")
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
	fun `a run write keeps the versions on disk`() = runTest {
		val directory = folder.newFolder().also { manifestFile(it).writeText("""{"versions":{"a1":"v3"}}""") }
		val manifest = manifest(directory)

		manifest.recordRun(OfflineDownloadRun(total = 2, completed = 1))
		assertFileHolds(directory, """{"versions":{"a1":"v3"},"run":{"total":2,"completed":1}}""")
		manifest.forgetRun()

		assertFileHolds(directory, """{"versions":{"a1":"v3"},"run":null}""")
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
	fun `a version write never carries a stale run`() = runTest {
		val directory = folder.newFolder()
		val manifest = manifest(directory)

		manifest.recordRun(OfflineDownloadRun(total = 5, completed = 2))
		manifest.recordDownloaded(articleId = "a1", contentVersion = "v1")
		manifest.recordRun(OfflineDownloadRun(total = 5, completed = 3))
		assertFileHolds(directory, """{"versions":{"a1":"v1"},"run":{"total":5,"completed":3}}""")
		manifest.forgetRun()
		manifest.recordDownloaded(articleId = "a2", contentVersion = "v2")

		assertFileHolds(directory, """{"versions":{"a1":"v1","a2":"v2"},"run":null}""")
	}

	private class HeldDispatcher : CoroutineDispatcher() {
		val held = mutableListOf<Runnable>()

		override fun dispatch(context: CoroutineContext, block: Runnable) {
			held.add(block)
		}
	}
}
