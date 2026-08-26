package com.readplace.android.core

import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.Duration
import java.time.Instant

class UploadJobTest {
	private val epoch: Instant = Instant.ofEpochSecond(1_000_000)

	private fun pendingJob(attempts: Int = 0, nextAttemptAt: Instant = epoch): UploadJob =
		UploadJob(
			id = "j1",
			url = "https://example.com/post",
			title = "A Title",
			state = UploadJob.State.CapturePending(detectedMediaType = null),
			attempts = attempts,
			nextAttemptAt = nextAttemptAt,
			createdAt = epoch,
		)

	// region backoff

	@Test
	fun `steps through the backoff table and holds at its last entry`() {
		var job = pendingJob()
		val delays = mutableListOf<Long>()

		var next = job.retried(now = epoch)
		while (next != null) {
			delays.add(Duration.between(epoch, next.nextAttemptAt).seconds)
			job = next
			next = job.retried(now = epoch)
		}

		assertEquals(listOf(60L, 300L, 900L, 3600L, 10800L, 21600L, 21600L), delays)
		assertEquals(7, job.attempts)
	}

	@Test
	fun `stops retrying once the attempt budget is spent`() {
		assertEquals(7, pendingJob(attempts = 6).retried(now = epoch)?.attempts)
		assertNull(
			"eight attempts is the whole budget, after which the job is dropped rather than kept forever",
			pendingJob(attempts = 7).retried(now = epoch),
		)
	}

	@Test
	fun `carries the rest of the job across a retry`() {
		val retried = requireNotNull(pendingJob().retried(now = epoch))

		assertEquals("j1", retried.id)
		assertEquals("https://example.com/post", retried.url)
		assertEquals("A Title", retried.title)
		assertEquals(epoch, retried.createdAt)
	}

	// endregion

	// region due time

	@Test
	fun `is due only once its scheduled instant has arrived`() {
		val job = pendingJob(nextAttemptAt = epoch)

		assertFalse(job.isDue(now = epoch.minusSeconds(1)))
		assertTrue(job.isDue(now = epoch))
		assertTrue(job.isDue(now = epoch.plusSeconds(1)))
	}

	// endregion

	// region record

	@Test
	fun `round trips each state through its record`() {
		val pending = pendingJob()
		val ready = pending.staged(contentType = "multipart/form-data; boundary=b")
		val detecting = pending.detecting(mediaType = "application/pdf")

		assertEquals(UploadJob.State.Ready(contentType = "multipart/form-data; boundary=b"), ready.state)
		assertEquals(UploadJob.State.CapturePending(detectedMediaType = "application/pdf"), detecting.state)
		assertEquals(pending, UploadJob.fromRecord(pending.toRecord()))
		assertEquals(ready, UploadJob.fromRecord(ready.toRecord()))
		assertEquals(detecting, UploadJob.fromRecord(detecting.toRecord()))
	}

	@Test
	fun `writes a pending record with its kind and without the media type it has not detected`() {
		assertEquals(
			"""{"id":"j1","url":"https://example.com/post","title":"A Title",""" +
				""""state":{"kind":"capturePending"},"attempts":0,""" +
				""""nextAttemptAt":"1970-01-12T13:46:40Z","createdAt":"1970-01-12T13:46:40Z"}""",
			pendingJob().toRecord(),
		)
	}

	@Test
	fun `decodes a ready record carrying its content type`() {
		val record = """
			{
				"id": "j1", "url": "https://example.com/post", "title": "A Title",
				"state": { "kind": "ready", "contentType": "multipart/form-data; boundary=b" },
				"attempts": 0, "nextAttemptAt": "1970-01-01T00:00:00Z", "createdAt": "1970-01-01T00:00:00Z"
			}
		"""

		val job = UploadJob.fromRecord(record)

		assertEquals(UploadJob.State.Ready(contentType = "multipart/form-data; boundary=b"), job.state)
		assertEquals(Instant.EPOCH, job.nextAttemptAt)
		assertEquals(Instant.EPOCH, job.createdAt)
	}

	@Test
	fun `decodes a record carrying a field this build does not know`() {
		val record = """
			{
				"id": "j1", "url": "https://example.com/post", "title": "A Title", "note": "x",
				"state": { "kind": "capturePending" },
				"attempts": 0, "nextAttemptAt": "1970-01-12T13:46:40Z", "createdAt": "1970-01-12T13:46:40Z"
			}
		"""

		assertEquals(
			"a record written by a later build is still a job — the field it added is ignored, not fatal",
			pendingJob(),
			UploadJob.fromRecord(record),
		)
	}

	@Test
	fun `decodes a record whose state carries a field this build does not know`() {
		val record = """
			{
				"id": "j1", "url": "https://example.com/post", "title": "A Title",
				"state": { "kind": "ready", "contentType": "multipart/form-data; boundary=b", "note": "x" },
				"attempts": 0, "nextAttemptAt": "1970-01-12T13:46:40Z", "createdAt": "1970-01-12T13:46:40Z"
			}
		"""

		assertEquals(
			"the state is decoded through the same lenient reader as the record around it",
			pendingJob().staged(contentType = "multipart/form-data; boundary=b"),
			UploadJob.fromRecord(record),
		)
	}

	@Test
	fun `rejects a ready record missing its content type`() {
		val record = """
			{
				"id": "j1", "url": "https://example.com/post", "title": "A Title",
				"state": { "kind": "ready" },
				"attempts": 0, "nextAttemptAt": "1970-01-01T00:00:00Z", "createdAt": "1970-01-01T00:00:00Z"
			}
		"""

		try {
			UploadJob.fromRecord(record)
			fail("a ready job whose body could never be found must fail its decode so the store drops it")
		} catch (_: SerializationException) {
		}
	}

	@Test
	fun `rejects a record whose schedule is not an instant`() {
		val record = """
			{
				"id": "j1", "url": "https://example.com/post", "title": "A Title",
				"state": { "kind": "capturePending" },
				"attempts": 0, "nextAttemptAt": "whenever", "createdAt": "1970-01-01T00:00:00Z"
			}
		"""

		try {
			UploadJob.fromRecord(record)
			fail("a job that can never be told due must fail its decode so the store drops it")
		} catch (error: SerializationException) {
			assertEquals("Not an ISO-8601 instant: whenever", error.message)
		}
	}

	// endregion
}
