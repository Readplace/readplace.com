package com.readplace.android.core

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.UUID

class UploadJobStoreTest {
	@get:Rule
	val temporaryFolder = TemporaryFolder()

	private val epoch: Instant = Instant.ofEpochSecond(1_000_000)

	private fun TestScope.makeStore(): UploadJobStore =
		UploadJobStore(filesRoot = temporaryFolder.root, io = StandardTestDispatcher(testScheduler))

	private fun queueDirectory(): File = File(temporaryFolder.root, "upload-queue")

	private fun queueEntries(): List<String> = queueDirectory().list().orEmpty().sorted()

	private fun job(
		id: String,
		url: String = "https://example.com/post",
		createdAt: Instant = epoch,
		nextAttemptAt: Instant = epoch,
	): UploadJob =
		UploadJob(
			id = id,
			url = url,
			title = "A Title",
			state = UploadJob.State.CapturePending(detectedMediaType = null),
			attempts = 0,
			nextAttemptAt = nextAttemptAt,
			createdAt = createdAt,
		)

	private fun multipartForm(
		content: ByteArray = "<html><body>hi</body></html>".toByteArray(Charsets.UTF_8),
	): MultipartForm =
		MultipartForm(
			boundary = UUID.randomUUID().toString(),
			textParts = listOf(
				MultipartForm.TextPart(name = "url", value = "https://example.com/post"),
				MultipartForm.TextPart(name = "mediaType", value = "text/html"),
			),
			filePart = MultipartForm.FilePart(name = "content", filename = "content", bytes = content),
		)

	// region admitting

	@Test
	fun `admits a job under the upload queue of the files root`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")

		store.admit(admitted)

		assertEquals(listOf(admitted), store.loadAll(now = epoch))
		assertEquals(
			"a queued upload is a durable promise, so it must sit under the files root the system " +
				"does not purge, never the cache",
			queueDirectory(),
			store.bytesFile(admitted).parentFile,
		)
	}

	@Test
	fun `supersedes an earlier job for the same link`() = runTest {
		val store = makeStore()
		val first = job(id = "j1", url = "https://example.com/post")
		store.admit(first)
		store.stageReady(first, multipartForm())
		val other = job(id = "j3", url = "https://example.com/other", createdAt = epoch.plusSeconds(2))
		store.admit(other)

		val second = job(id = "j2", url = "https://example.com/post", createdAt = epoch.plusSeconds(1))
		store.admit(second)

		assertEquals(listOf("j2", "j3"), store.loadAll(now = epoch.plusSeconds(2)).map { it.id })
		assertEquals(
			"the superseded job's staged body goes with its record",
			listOf("j2.json", "j3.json"),
			queueEntries(),
		)
	}

	// endregion

	// region staging

	@Test
	fun `stages the body then flips the record to ready`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")
		store.admit(admitted)
		val form = multipartForm(content = "<html>hi</html>".toByteArray(Charsets.UTF_8))

		val ready = store.stageReady(admitted, form)

		assertEquals(UploadJob.State.Ready(contentType = form.contentType), ready.state)
		assertEquals(listOf(ready), store.loadAll(now = epoch))
		assertArrayEquals(form.body(), store.bytesFile(ready).readBytes())
	}

	@Test
	fun `leaves the record pending when its body cannot be staged`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")
		store.admit(admitted)
		store.bytesFile(admitted).mkdirs()

		try {
			store.stageReady(admitted, multipartForm())
			fail("a body that could not be written must not produce a ready record")
		} catch (_: IOException) {
			assertEquals(
				"the bytes land before the record, so a ready record always finds its body",
				listOf(UploadJob.State.CapturePending(detectedMediaType = null)),
				store.loadAll(now = epoch).map { it.state },
			)
		}
	}

	@Test
	fun `resurrects nothing when staging into a purged queue`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")
		store.admit(admitted)
		store.purgeAll()

		try {
			store.stageReady(admitted, multipartForm())
			fail("staging into a purged queue must throw rather than re-create it")
		} catch (_: IOException) {
			assertEquals(
				"a sign-out purge is final: an in-flight capture must not write the queue back into being",
				emptyList<UploadJob>(),
				store.loadAll(now = epoch),
			)
			assertEquals(emptyList<String>(), temporaryFolder.root.list().orEmpty().toList())
		}
	}

	// endregion

	// region loading

	@Test
	fun `loads due jobs oldest first`() = runTest {
		val store = makeStore()
		val newer = job(id = "j2", url = "https://example.com/two", createdAt = epoch.plusSeconds(60))
		val older = job(id = "j1", url = "https://example.com/one", createdAt = epoch)
		store.admit(newer)
		store.admit(older)

		assertEquals(listOf("j1", "j2"), store.loadAll(now = epoch).map { it.id })
	}

	@Test
	fun `holds back a job whose next attempt has not arrived`() = runTest {
		val store = makeStore()
		val waiting = job(id = "j1", nextAttemptAt = epoch.plusSeconds(60))
		store.admit(waiting)

		assertEquals(emptyList<UploadJob>(), store.loadAll(now = epoch))
		assertEquals(listOf(waiting), store.loadAll(now = epoch.plusSeconds(60)))
	}

	@Test
	fun `drops a malformed record and keeps the rest`() = runTest {
		val store = makeStore()
		val survivor = job(id = "j1")
		store.admit(survivor)
		File(queueDirectory(), "broken.json").writeText("{ not a record")

		assertEquals(listOf(survivor), store.loadAll(now = epoch))
	}

	@Test
	fun `drops a record entry it cannot read and keeps the rest`() = runTest {
		val store = makeStore()
		val survivor = job(id = "j1")
		store.admit(survivor)
		File(queueDirectory(), "unreadable.json").mkdirs()

		assertEquals(listOf(survivor), store.loadAll(now = epoch))
	}

	// endregion

	// region updating and removing

	@Test
	fun `update rewrites the record in place`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")
		store.admit(admitted)
		val retried = requireNotNull(admitted.retried(now = epoch))

		store.update(retried)

		assertEquals(listOf(retried), store.loadAll(now = epoch.plusSeconds(60)))
		assertEquals(listOf("j1.json"), queueEntries())
	}

	@Test
	fun `remove deletes the record and its staged body`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")
		store.admit(admitted)
		val ready = store.stageReady(admitted, multipartForm())
		val survivor = job(id = "j2", url = "https://example.com/other")
		store.admit(survivor)

		store.remove(ready)

		assertEquals(listOf(survivor), store.loadAll(now = epoch))
		assertEquals(listOf("j2.json"), queueEntries())
	}

	@Test
	fun `sweeps bytes left behind without their record`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")
		store.admit(admitted)
		store.stageReady(admitted, multipartForm())
		store.bytesFile(job(id = "gone")).writeText("stale body")

		store.removeOrphanedBytes()

		assertEquals(listOf("j1.json", "j1.multipart"), queueEntries())
	}

	@Test
	fun `purge all empties the queue`() = runTest {
		val store = makeStore()
		val admitted = job(id = "j1")
		store.admit(admitted)
		store.stageReady(admitted, multipartForm())

		store.purgeAll()

		assertEquals(emptyList<UploadJob>(), store.loadAll(now = epoch))
		assertFalse(queueDirectory().exists())
	}

	// endregion
}
