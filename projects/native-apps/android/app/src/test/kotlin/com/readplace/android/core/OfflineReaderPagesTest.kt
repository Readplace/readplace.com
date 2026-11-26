package com.readplace.android.core

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Duration
import java.time.Instant

class OfflineReaderPagesTest {
	@get:Rule
	val folder = TemporaryFolder()

	private val readerUrl = "https://readplace.com/queue/a1/view?platform=android"

	private fun TestScope.pages(
		directory: File = folder.newFolder(),
		now: () -> Instant = { SAVED_AT },
		generation: () -> Long = { 0 },
	): OfflineReaderPages = OfflineReaderPages(directory, StandardTestDispatcher(testScheduler), now = now, currentGeneration = generation)

	private fun response(body: String = "<p>Body</p>", csp: String? = "frame-ancestors 'self'"): ReaderPageResponse =
		ReaderPageResponse(contentType = "text/html; charset=utf-8", contentSecurityPolicy = csp, contentVersion = "v1", body = body.toByteArray())

	private suspend fun OfflineReaderPages.keepA1(response: ReaderPageResponse = response(), contentVersion: String? = "v1", generation: Long = 0): Boolean =
		keep(readerUrl = readerUrl, articleId = "a1", contentVersion = contentVersion, response = response, generation = generation)

	private fun StoredReaderPage?.described(): List<Any?>? =
		this?.let { listOf(it.savedAt, it.articleId, it.contentVersion, it.contentType, it.contentSecurityPolicy, String(it.body)) }

	@Test
	fun `a kept page is found with its headers, version and the time it was saved`() = runTest {
		val pages = pages()

		val kept = pages.keepA1()

		assertEquals(
			listOf(true, listOf(SAVED_AT, "a1", "v1", "text/html; charset=utf-8", "frame-ancestors 'self'", "<p>Body</p>")),
			listOf(kept, pages.find(readerUrl).described()),
		)
	}

	@Test
	fun `a page kept without a policy header replays none`() = runTest {
		val pages = pages()

		pages.keepA1(response = response(csp = null))

		assertEquals(null, pages.find(readerUrl)?.contentSecurityPolicy)
		assertEquals("<p>Body</p>", pages.find(readerUrl)?.body?.let(::String))
	}

	@Test
	fun `a body holding newlines comes back byte for byte`() = runTest {
		val pages = pages()
		val body = "<html>\n<body>\r\n<p>One</p>\n</body></html>\n"

		pages.keepA1(response = response(body = body))

		assertEquals(body, pages.find(readerUrl)?.body?.let(::String))
	}

	@Test
	fun `a page is shown up to thirty days after it was saved and not a second later`() = runTest {
		var now = SAVED_AT
		val pages = pages(now = { now })
		pages.keepA1()

		now = SAVED_AT + OfflineCopy.MAXIMUM_AGE
		val atThirtyDays = pages.find(readerUrl) != null
		now = SAVED_AT + OfflineCopy.MAXIMUM_AGE + Duration.ofSeconds(1)

		assertEquals(listOf(true, null), listOf(atThirtyDays, pages.find(readerUrl)))
	}

	@Test
	fun `a corrupt or truncated file reads as no page`() = runTest {
		val directory = folder.newFolder()
		val pages = pages(directory = directory)
		pages.keepA1()
		val file = File(directory, "reader-pages").listFiles().orEmpty().single()

		file.writeText("{\"savedAt\":")
		val truncated = pages.find(readerUrl)
		file.writeText("not json\n<p>Body</p>")

		assertEquals(listOf(null, null), listOf(truncated, pages.find(readerUrl)))
	}

	@Test
	fun `a second keep replaces the first`() = runTest {
		val pages = pages()
		pages.keepA1(response = response(body = "<p>Old</p>"), contentVersion = "v1")

		pages.keepA1(response = response(body = "<p>New</p>"), contentVersion = "v2")

		assertEquals(listOf("v2", "<p>New</p>"), pages.find(readerUrl)?.let { listOf(it.contentVersion, String(it.body)) })
	}

	@Test
	fun `a page is current only at the version it was kept with and while it can be shown`() = runTest {
		var now = SAVED_AT
		val pages = pages(now = { now })
		pages.keepA1(contentVersion = "v1")

		val answers = listOf(
			pages.isCurrent(readerUrl, contentVersion = "v1"),
			pages.isCurrent(readerUrl, contentVersion = "v2"),
			pages.isCurrent(readerUrl, contentVersion = null),
			pages.isCurrent("https://readplace.com/queue/a2/view", contentVersion = "v1"),
		)
		now = SAVED_AT + OfflineCopy.MAXIMUM_AGE + Duration.ofSeconds(1)

		assertEquals(listOf(true, false, false, false, false), answers + pages.isCurrent(readerUrl, contentVersion = "v1"))
	}

	@Test
	fun `kept pages publish their versions, and a load rebuilds them from disk without the expired ones`() = runTest {
		val directory = folder.newFolder()
		var now = SAVED_AT
		val writer = pages(directory = directory, now = { now })
		writer.keep(readerUrl = "https://readplace.com/queue/old/view", articleId = "old", contentVersion = "v0", response = response(), generation = 0)
		now = SAVED_AT + Duration.ofDays(2)
		writer.keepA1(contentVersion = "v1")
		writer.keep(readerUrl = "https://readplace.com/queue/nov/view", articleId = "nov", contentVersion = null, response = response(), generation = 0)
		val published = writer.versions.value

		now = SAVED_AT + OfflineCopy.MAXIMUM_AGE + Duration.ofDays(1)
		val reader = pages(directory = directory, now = { now })
		reader.load()

		assertEquals(
			listOf(
				DownloadedVersions(
					mapOf(
						"https://readplace.com/queue/old/view" to KeptVersion("v0", savedAt = SAVED_AT),
						readerUrl to KeptVersion("v1", savedAt = SAVED_AT + Duration.ofDays(2)),
					),
				),
				DownloadedVersions(mapOf(readerUrl to KeptVersion("v1", savedAt = SAVED_AT + Duration.ofDays(2)))),
				1,
			),
			listOf(published, reader.versions.value, File(directory, "reader-pages").listFiles().orEmpty().size - 1),
		)
	}

	@Test
	fun `a write the process was killed during publishes no version and is removed on the next load`() = runTest {
		val directory = folder.newFolder()
		pages(directory = directory).keepA1()
		val kept = File(directory, "reader-pages").listFiles().orEmpty().single()
		val staged = File(kept.parentFile, kept.name + ".tmp")
		kept.renameTo(staged)

		val reader = pages(directory = directory)
		reader.load()

		assertEquals(listOf(DownloadedVersions(emptyMap()), false), listOf(reader.versions.value, staged.exists()))
	}

	@Test
	fun `a load after the directory was deleted publishes nothing`() = runTest {
		val directory = folder.newFolder()
		val pages = pages(directory = directory)
		pages.keepA1()

		directory.deleteRecursively()
		pages.load()

		assertEquals(DownloadedVersions(emptyMap()), pages.versions.value)
	}

	@Test
	fun `a keep for a run started before a purge writes nothing`() = runTest {
		val directory = folder.newFolder()
		val pages = pages(directory = directory, generation = { 1 })

		val kept = pages.keepA1(generation = 0)

		assertEquals(listOf(false, null, false), listOf(kept, pages.find(readerUrl), File(directory, "reader-pages").exists()))
	}

	@Test
	fun `a purge that lands while a page is written leaves no page behind`() = runTest {
		var reads = 0L
		val pages = pages(generation = { reads++ })

		val kept = pages.keepA1(generation = 0)

		assertEquals(listOf(false, null, DownloadedVersions(emptyMap())), listOf(kept, pages.find(readerUrl), pages.versions.value))
	}

	@Test
	fun `a page that cannot be written is not kept`() = runTest {
		val directory = folder.newFolder()
		File(directory, "reader-pages").writeText("a file where the directory belongs")
		val pages = pages(directory = directory)

		val kept = pages.keepA1()

		assertEquals(listOf(false, DownloadedVersions(emptyMap())), listOf(kept, pages.versions.value))
	}

	@Test
	fun `a published version is current only for the reader URL it was kept under, at its version, until thirty days have passed`() = runTest {
		val pages = pages()
		pages.keepA1(contentVersion = "v1")
		val versions = pages.versions.value

		assertEquals(
			listOf(true, true, false, false, false),
			listOf(
				versions.isCurrent(readerUrl, contentVersion = "v1", now = SAVED_AT),
				versions.isCurrent(readerUrl, contentVersion = "v1", now = SAVED_AT + OfflineCopy.MAXIMUM_AGE),
				versions.isCurrent(readerUrl, contentVersion = "v1", now = SAVED_AT + OfflineCopy.MAXIMUM_AGE + Duration.ofSeconds(1)),
				versions.isCurrent("https://readplace.com/queue/a1/view?readlist=work&platform=android", contentVersion = "v1", now = SAVED_AT),
				versions.isCurrent(readerUrl, contentVersion = "v2", now = SAVED_AT),
			),
		)
	}

	@Test
	fun `a page kept by an earlier build without its reader URL still opens but publishes no version`() = runTest {
		val directory = folder.newFolder()
		pages(directory = directory).keepA1()
		val file = File(directory, "reader-pages").listFiles().orEmpty().single()
		file.writeText(file.readText().replace(",\"readerUrl\":\"$readerUrl\"", ""))

		val reader = pages(directory = directory)
		reader.load()

		assertEquals(
			listOf(DownloadedVersions(emptyMap()), "<p>Body</p>", false),
			listOf(reader.versions.value, reader.find(readerUrl)?.body?.let(::String), file.readText().contains("readerUrl")),
		)
	}

	private companion object {
		val SAVED_AT: Instant = Instant.parse("2026-11-20T10:00:00Z")
	}
}
