package com.readplace.android.core

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant

class OfflineReadlistSnapshotTest {
	@get:Rule
	val folder = TemporaryFolder()

	private var clock = Instant.parse("2026-11-12T00:00:00Z")

	private fun TestScope.snapshot(directory: File): OfflineReadlistSnapshot =
		OfflineReadlistSnapshot(directory, StandardTestDispatcher(testScheduler), now = { clock })

	private fun article(id: String): String =
		"""{ "class": ["article"], "rel": ["item"], "properties": { "id": "$id", "url": "https://example.com/$id", "status": "unread" }, "links": [{ "rel": ["read"], "href": "/queue/$id/view" }] }"""

	private fun body(ids: List<String>, currentTab: String?): ByteArray {
		val tabs = if (currentTab == null) "" else """, "tabs": [{ "label": "To Read", "rel": "current", "href": "$currentTab" }]"""
		return """
			{
				"class": ["collection", "articles"],
				"properties": { "total": ${ids.size}, "page": 1, "pageSize": 20$tabs },
				"entities": [${ids.joinToString(",") { article(it) }}],
				"links": [{ "rel": ["root"], "href": "/queue" }]
			}
		""".toByteArray(Charsets.UTF_8)
	}

	private fun page(ids: List<String>, currentTab: String?, href: String = "/queue"): ReadlistPage {
		val page = ReadlistPage.stored(body(ids, currentTab), href = href)
		checkNotNull(page) { "the fixture body is a collection" }
		return page
	}

	private fun ids(page: ReadlistPage?): List<String>? = page?.articles?.map { it.id }

	private fun fileFor(directory: File, key: String): File {
		val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
		return File(directory, "readlist-pages/" + digest.joinToString("") { "%02x".format(it) } + ".json")
	}

	@Test
	fun `a first page reads back under the href it was asked for`() = runTest {
		val snapshot = snapshot(folder.newFolder())

		snapshot.keepFirstPage(page(listOf("a1", "a2"), currentTab = null), href = "/queue?readlist=main", generation = snapshot.generation)

		assertEquals(listOf("a1", "a2"), ids(snapshot.firstPage("/queue?readlist=main")))
	}

	@Test
	fun `an entry-point page reads back under the entry point and the tab it names`() = runTest {
		val snapshot = snapshot(folder.newFolder())

		snapshot.keepFirstPage(page(listOf("a1"), currentTab = "/queue?status=unread"), href = null, generation = snapshot.generation)

		assertEquals(
			listOf(listOf("a1"), listOf("a1")),
			listOf(ids(snapshot.firstPage(null)), ids(snapshot.firstPage("/queue?status=unread"))),
		)
	}

	@Test
	fun `a first page follows the newer copy of the tab it names`() = runTest {
		val snapshot = snapshot(folder.newFolder())

		snapshot.keepFirstPage(page(listOf("m1"), currentTab = "/queue?status=unread"), href = "/queue?readlist=main", generation = snapshot.generation)
		snapshot.keepFirstPage(page(listOf("t1", "t2", "t3", "m1"), currentTab = "/queue?status=unread"), href = "/queue?status=unread", generation = snapshot.generation)

		assertEquals(listOf("t1", "t2", "t3", "m1"), ids(snapshot.firstPage("/queue?readlist=main")))
	}

	@Test
	fun `a next page reads back as itself, never the tab it names`() = runTest {
		val snapshot = snapshot(folder.newFolder())

		snapshot.keepFirstPage(page(listOf("t1"), currentTab = "/queue?status=unread"), href = "/queue?status=unread", generation = snapshot.generation)
		snapshot.keepNextPage(page(listOf("p2"), currentTab = "/queue?status=unread"), href = "/queue?page=2", generation = snapshot.generation)

		assertEquals(listOf("p2"), ids(snapshot.nextPage("/queue?page=2")))
	}

	@Test
	fun `a copy older than thirty days is not shown`() = runTest {
		val snapshot = snapshot(folder.newFolder())
		snapshot.keepFirstPage(page(listOf("a1"), currentTab = null), href = "/queue", generation = snapshot.generation)
		val saved = clock

		clock = saved.plus(Duration.ofDays(30))
		assertEquals(listOf("a1"), ids(snapshot.firstPage("/queue")))

		clock = saved.plus(Duration.ofDays(30).plusSeconds(1))
		assertEquals(null, snapshot.firstPage("/queue"))
	}

	@Test
	fun `a page without its body is not kept`() = runTest {
		val directory = folder.newFolder()
		val snapshot = snapshot(directory)
		val collection = checkNotNull(SirenDecoding.collection(Json.parseToJsonElement(String(body(listOf("a1"), currentTab = null)))))

		snapshot.keepFirstPage(ReadlistPage(collection, chain = listOf("/queue"), sirenBody = null, isStoredCopy = false), href = "/queue", generation = snapshot.generation)

		assertEquals(emptyList<File>(), directory.resolve("readlist-pages").listFiles()?.toList().orEmpty())
	}

	@Test
	fun `a file that is not a kept record reads as nothing, and its siblings still read`() = runTest {
		val directory = folder.newFolder()
		val snapshot = snapshot(directory)
		snapshot.keepFirstPage(page(listOf("a1"), currentTab = null), href = "/queue", generation = snapshot.generation)
		snapshot.keepFirstPage(page(listOf("b1"), currentTab = null), href = "/queue?queue=work", generation = snapshot.generation)

		fileFor(directory, "/queue").writeText("{")

		assertEquals(
			listOf(null, listOf("b1")),
			listOf(ids(snapshot.firstPage("/queue")), ids(snapshot.firstPage("/queue?queue=work"))),
		)
	}

	@Test
	fun `a root that cannot be written never fails the list read`() = runTest {
		val snapshot = snapshot(folder.newFile("a-file-where-the-root-should-be"))

		snapshot.keepFirstPage(page(listOf("a1"), currentTab = null), href = "/queue", generation = snapshot.generation)

		assertEquals(null, snapshot.firstPage("/queue"))
	}

	@Test
	fun `a first page whose tab copy is unreadable shows itself`() = runTest {
		val directory = folder.newFolder()
		val snapshot = snapshot(directory)
		snapshot.keepFirstPage(page(listOf("a1"), currentTab = "/queue?status=unread"), href = "/queue?readlist=main", generation = snapshot.generation)

		fileFor(directory, "/queue?status=unread").writeText("{")

		assertEquals(listOf("a1"), ids(snapshot.firstPage("/queue?readlist=main")))
	}

	@Test
	fun `a page read before a purge is not kept once the purge has run`() = runTest {
		val directory = folder.newFolder()
		val snapshot = snapshot(directory)
		val readStarted = snapshot.generation

		snapshot.purge()
		snapshot.keepFirstPage(page(listOf("a1"), currentTab = "/queue?status=unread"), href = null, generation = readStarted)
		snapshot.keepNextPage(page(listOf("a2"), currentTab = null), href = "/queue?page=2", generation = readStarted)

		assertEquals(
			listOf(null, null, false),
			listOf(ids(snapshot.firstPage(null)), ids(snapshot.nextPage("/queue?page=2")), directory.exists()),
		)
	}

	@Test
	fun `a page read after a purge is kept`() = runTest {
		val snapshot = snapshot(folder.newFolder())
		snapshot.keepFirstPage(page(listOf("old"), currentTab = null), href = null, generation = snapshot.generation)

		snapshot.purge()
		snapshot.keepFirstPage(page(listOf("new"), currentTab = null), href = null, generation = snapshot.generation)

		assertEquals(listOf("new"), ids(snapshot.firstPage(null)))
	}
}
