package com.readplace.android.app

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Gate
import com.readplace.android.RecordingServer.Record
import com.readplace.android.RecordingServer.Stub
import com.readplace.android.core.AccessToken
import com.readplace.android.core.ApiError
import com.readplace.android.core.DownloadedVersions
import com.readplace.android.core.EphemeralCookieJar
import com.readplace.android.core.OAuth
import com.readplace.android.core.OAuthTokens
import com.readplace.android.core.OfflineCopy
import com.readplace.android.core.OfflineDownloadManifest
import com.readplace.android.core.OfflineDownloadRun
import com.readplace.android.core.OfflineReaderCopy
import com.readplace.android.core.OfflineReadlistSnapshot
import com.readplace.android.core.ReaderPrefetching
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.RefreshToken
import com.readplace.android.core.ServerEndpoints
import com.readplace.android.core.TokenKey
import com.readplace.android.core.TokenStorage
import com.readplace.android.core.TokenStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant

class DownloadUnreadOfflineTest {
	@get:Rule
	val server = RecordingServer()

	@get:Rule
	val folder = TemporaryFolder()

	private class MemoryTokenStorage : TokenStorage {
		private val stored = mutableMapOf<TokenKey, String>()

		override fun readValue(key: TokenKey): Result<String?> = Result.success(stored[key])

		override fun setValue(key: TokenKey, value: String) {
			stored[key] = value
		}

		override fun removeValue(key: TokenKey) {
			stored.remove(key)
		}
	}

	private class RecordingPrefetcher(
		private val held: CompletableDeferred<Unit>? = null,
		private val answer: (String) -> Boolean = { true },
	) : ReaderPrefetching {
		val urls = mutableListOf<String>()
		val cookies = mutableListOf<List<String>>()
		val started = CompletableDeferred<Unit>()
		var inFlight = 0
		var mostInFlight = 0

		override suspend fun prefetch(url: String, cookies: List<Cookie>): Boolean {
			urls += url
			this.cookies += cookies.map { "${it.name}=${it.value}" }
			inFlight += 1
			mostInFlight = maxOf(mostInFlight, inFlight)
			started.complete(Unit)
			try {
				held?.await()
				return answer(url)
			} finally {
				inFlight -= 1
			}
		}
	}

	private fun TestScope.api(ioDispatcher: CoroutineDispatcher = StandardTestDispatcher(testScheduler)): ReadplaceApi {
		val store = TokenStore(MemoryTokenStorage())
		store.save(OAuthTokens(AccessToken("access-1"), RefreshToken("refresh-1")))
		val oauth = OAuth(endpoints = ServerEndpoints(server.baseUrl), store = store, http = OkHttpClient(), nativeUserAgent = USER_AGENT)
		val client = OkHttpClient.Builder().cookieJar(EphemeralCookieJar()).followRedirects(false).build()
		return ReadplaceApi(server.baseUrl, client, oauth, USER_AGENT, ioDispatcher)
	}

	private fun TestScope.snapshot(): OfflineReadlistSnapshot =
		OfflineReadlistSnapshot(folder.newFolder(), StandardTestDispatcher(testScheduler), now = { Instant.EPOCH }, diagnostics = {})

	private fun TestScope.download(
		prefetcher: ReaderPrefetching,
		snapshot: OfflineReadlistSnapshot = snapshot(),
		readerCopy: OfflineReaderCopy = readerCopy(),
		ioDispatcher: CoroutineDispatcher = StandardTestDispatcher(testScheduler),
		manifest: OfflineDownloadManifest = manifest(),
	): DownloadUnreadOffline = DownloadUnreadOffline(api(ioDispatcher), snapshot, prefetcher, manifest, readerCopy)

	private fun TestScope.manifest(directory: File = folder.newFolder()): OfflineDownloadManifest =
		OfflineDownloadManifest(directory, StandardTestDispatcher(testScheduler))

	private fun writeManifest(directory: File, versions: Map<String, String>) {
		val entries = versions.entries.joinToString(",") { (id, version) -> "\"$id\": \"$version\"" }
		File(directory, "download-manifest.json").writeText("""{ "versions": { $entries } }""")
	}

	private fun TestScope.readerCopy(directory: File = folder.newFolder(), now: Instant = Instant.EPOCH): OfflineReaderCopy =
		OfflineReaderCopy(directory, StandardTestDispatcher(testScheduler), now = { now })

	private fun readerUrl(id: String): String = "${server.baseUrl}/queue/$id/view?platform=android"

	private fun listing(
		pages: List<List<String>>,
		gate: Gate? = null,
		mint: Stub = MINTED,
		markedNextOn: Set<Int> = emptySet(),
	): (Record) -> Stub = { record ->
		val number = record.request.url.queryParameter("page")?.toInt() ?: 1
		when {
			record.path == "/auth/session" -> mint
			record.path == "/queue" && number == 2 && gate != null -> gate.holding(Stub.json(200, page(pages, number, markedNextOn)))
			record.path == "/queue" && number <= pages.size -> Stub.json(200, page(pages, number, markedNextOn))
			else -> Stub.json(404, "{}")
		}
	}

	private fun page(pages: List<List<String>>, number: Int, markedNextOn: Set<Int>): String =
		Fixtures.collection(
			pages[number - 1],
			next = if (number < pages.size) "/queue?page=${number + 1}" else null,
			nextMarked = number in markedNextOn,
		)

	private fun pageHeaders(): List<Pair<String?, String?>> =
		server.records("/queue").map { it.request.url.queryParameter("page") to it.header("Sec-Purpose") }

	@Test
	fun `a listing page reached through a next link marked for offline prefetch is loaded as a prefetch`() = runTest {
		server.handle(
			listing(
				listOf(listOf(Fixtures.article("a1")), listOf(Fixtures.article("a2")), listOf(Fixtures.article("a3"))),
				markedNextOn = setOf(2),
			),
		)

		download(RecordingPrefetcher()).run(START) {}

		assertEquals(listOf(null to null, "2" to null, "3" to "prefetch"), pageHeaders())
	}

	@Test
	fun `a third listing page behind an unmarked next link is loaded as an ordinary request`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1")), listOf(Fixtures.article("a2")), listOf(Fixtures.article("a3")))))

		download(RecordingPrefetcher()).run(START) {}

		assertEquals(listOf(null to null, "2" to null, "3" to null), pageHeaders())
	}

	@Test
	fun `a second listing page behind a marked next link is loaded as a prefetch`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1")), listOf(Fixtures.article("a2"))), markedNextOn = setOf(1)))

		download(RecordingPrefetcher()).run(START) {}

		assertEquals(listOf(null to null, "2" to "prefetch"), pageHeaders())
	}

	@Test
	fun `each unread article with a read link is stored once at the URL the reader opens`() = runTest {
		server.handle(
			listing(
				listOf(
					listOf(Fixtures.article("a1"), Fixtures.readArticle("r1"), Fixtures.article("n1", readLink = false)),
					listOf(Fixtures.article("a2")),
				),
			),
		)
		val prefetcher = RecordingPrefetcher()
		val reports = mutableListOf<OfflineDownloadProgress>()

		download(prefetcher).run(START) { reports += it }

		assertEquals(listOf(readerUrl("a1"), readerUrl("a2")), prefetcher.urls)
		assertEquals(OfflineDownloadProgress(completed = 2, total = 2), reports.last())
	}

	@Test
	fun `one session mint serves the whole run`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"), Fixtures.article("a2")), listOf(Fixtures.article("a3")))))
		val prefetcher = RecordingPrefetcher()

		download(prefetcher).run(START) {}

		assertEquals(1, server.records("/auth/session").size)
		assertEquals(List(3) { listOf("hutch_sid=sess-1") }, prefetcher.cookies)
	}

	@Test
	fun `a list with nothing unread mints nothing and finds nothing`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.readArticle("r1")))))
		val reports = mutableListOf<OfflineDownloadProgress>()

		download(RecordingPrefetcher()).run(START) { reports += it }

		assertEquals(listOf(0, 0), listOf(server.records("/auth/session").size, reports.size))
	}

	@Test
	fun `at most four articles are stored at once`() = runTest {
		server.handle(listing(listOf(List(6) { Fixtures.article("a$it") })))
		val held = CompletableDeferred<Unit>()
		val prefetcher = RecordingPrefetcher(held = held)

		val run = launch { download(prefetcher).run(START) {} }
		runCurrent()
		val startedWhileHeld = prefetcher.urls.size
		held.complete(Unit)
		run.join()

		assertEquals(listOf(4, 4, 6), listOf(startedWhileHeld, prefetcher.mostInFlight, prefetcher.urls.size))
	}

	@Test
	fun `the first article is stored before the last listing page has answered`() = runTest {
		val gate = Gate()
		server.handle(listing(listOf(listOf(Fixtures.article("a1")), listOf(Fixtures.article("a2"))), gate = gate))
		val prefetcher = RecordingPrefetcher()

		val run = launch { download(prefetcher, ioDispatcher = Dispatchers.IO).run(START) {} }
		withContext(Dispatchers.IO) { gate.awaitArrival() }
		prefetcher.started.await()
		val storedWhilePageTwoHeld = prefetcher.urls.toList()
		gate.release()
		run.join()

		assertEquals(listOf(readerUrl("a1")), storedWhilePageTwoHeld)
	}

	@Test
	fun `an article that is not stored does not stop the others`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"), Fixtures.article("a2"), Fixtures.article("a3")))))
		val reports = mutableListOf<OfflineDownloadProgress>()

		download(RecordingPrefetcher(answer = { it != readerUrl("a1") })).run(START) { reports += it }

		assertEquals(OfflineDownloadProgress(completed = 3, total = 3), reports.last())
	}

	@Test
	fun `only an article the prefetcher stored is recorded as a stored copy`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"), Fixtures.article("a2")))))
		val readerCopy = readerCopy()

		download(RecordingPrefetcher(answer = { it == readerUrl("a1") }), readerCopy = readerCopy).run(START) {}

		assertEquals(listOf(true, false), listOf(readerCopy.isShowable(readerUrl("a1")), readerCopy.isShowable(readerUrl("a2"))))
	}

	@Test
	fun `a two-page run reports what it found and what it stored`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"), Fixtures.article("a2")), listOf(Fixtures.article("a3")))))
		val reports = mutableListOf<OfflineDownloadProgress>()
		val held = CompletableDeferred<Unit>()

		val run = launch { download(RecordingPrefetcher(held = held)).run(START) { reports += it } }
		runCurrent()
		held.complete(Unit)
		run.join()

		assertEquals(
			listOf(
				OfflineDownloadProgress(completed = 0, total = 2),
				OfflineDownloadProgress(completed = 0, total = 3),
				OfflineDownloadProgress(completed = 1, total = 3),
				OfflineDownloadProgress(completed = 2, total = 3),
				OfflineDownloadProgress(completed = 3, total = 3),
			),
			reports,
		)
	}

	@Test
	fun `every walked page is kept under the href the list asks for`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1")), listOf(Fixtures.article("a2")))))
		val snapshot = snapshot()

		download(RecordingPrefetcher(), snapshot = snapshot).run(START) {}

		assertEquals(
			listOf(listOf("a1"), listOf("a2")),
			listOf(snapshot.firstPage("/queue")?.articles?.map { it.id }, snapshot.nextPage("/queue?page=2")?.articles?.map { it.id }),
		)
	}

	@Test
	fun `a listing page the server fails ends the run with that failure`() = runTest {
		server.handle { record -> if (record.path == "/queue") Stub.json(500, "{}") else Stub.json(404, "{}") }

		val failure = runCatching { download(RecordingPrefetcher()).run(START) {} }.exceptionOrNull()

		assertEquals(500, (failure as? ApiError.Server)?.status)
	}

	@Test
	fun `a session mint the server fails ends the run with that failure`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"))), mint = Stub.json(500, "{}")))

		val failure = runCatching { download(RecordingPrefetcher()).run(START) {} }.exceptionOrNull()

		assertEquals(500, (failure as? ApiError.Server)?.status)
	}

	@Test
	fun `a cancelled run starts no further article`() = runTest {
		server.handle(listing(listOf(List(6) { Fixtures.article("a$it") })))
		val prefetcher = object : ReaderPrefetching {
			val urls = mutableListOf<String>()

			override suspend fun prefetch(url: String, cookies: List<Cookie>): Boolean {
				urls += url
				awaitCancellation()
			}
		}

		val run = launch { download(prefetcher).run(START) {} }
		runCurrent()
		run.cancel()
		run.join()
		runCurrent()

		assertEquals(listOf(true, 4), listOf(run.isCancelled, prefetcher.urls.size))
	}

	@Test
	fun `a row still processing is stored like any other`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1", processing = true)))))
		val prefetcher = RecordingPrefetcher()

		download(prefetcher).run(START) {}

		assertEquals(listOf(readerUrl("a1")), prefetcher.urls)
	}

	@Test
	fun `only an article stored with a content version is recorded in the manifest`() = runTest {
		server.handle(
			listing(
				listOf(
					listOf(
						Fixtures.article("a1", contentVersion = "v1"),
						Fixtures.article("a2", contentVersion = "v2"),
						Fixtures.article("a3"),
					),
				),
			),
		)
		val manifest = manifest()

		download(RecordingPrefetcher(answer = { it != readerUrl("a2") }), manifest = manifest).run(START) {}

		assertEquals(DownloadedVersions(mapOf("a1" to "v1")), manifest.versions.value)
	}

	@Test
	fun `a current stored copy is counted without being fetched again`() = runTest {
		val directory = folder.newFolder()
		writeManifest(directory, mapOf("a1" to "v1", "a2" to "v2-old"))
		server.handle(
			listing(
				listOf(
					listOf(
						Fixtures.article("a1", contentVersion = "v1"),
						Fixtures.article("a2", contentVersion = "v2-new"),
						Fixtures.article("a3", contentVersion = "v3"),
					),
				),
			),
		)
		val manifest = manifest(directory)
		val readerCopy = readerCopy()
		readerCopy.record(readerUrl("a1"))
		val prefetcher = RecordingPrefetcher()
		val reports = mutableListOf<OfflineDownloadProgress>()

		download(prefetcher, manifest = manifest, readerCopy = readerCopy).run(START) { reports += it }

		assertEquals(
			listOf(
				listOf(readerUrl("a2"), readerUrl("a3")),
				OfflineDownloadProgress(completed = 3, total = 3),
				DownloadedVersions(mapOf("a1" to "v1", "a2" to "v2-new", "a3" to "v3")),
			),
			listOf(prefetcher.urls, reports.last(), manifest.versions.value),
		)
	}

	@Test
	fun `a list whose unread copies are all current mints nothing and fetches nothing`() = runTest {
		val directory = folder.newFolder()
		writeManifest(directory, mapOf("a1" to "v1", "a2" to "v2"))
		server.handle(
			listing(listOf(listOf(Fixtures.article("a1", contentVersion = "v1"), Fixtures.article("a2", contentVersion = "v2")))),
		)
		val readerCopy = readerCopy()
		readerCopy.record(readerUrl("a1"))
		readerCopy.record(readerUrl("a2"))
		val prefetcher = RecordingPrefetcher()
		val reports = mutableListOf<OfflineDownloadProgress>()

		download(prefetcher, manifest = manifest(directory), readerCopy = readerCopy).run(START) { reports += it }

		assertEquals(
			listOf(
				emptyList<Record>(),
				emptyList<String>(),
				listOf(
					OfflineDownloadProgress(completed = 0, total = 2),
					OfflineDownloadProgress(completed = 1, total = 2),
					OfflineDownloadProgress(completed = 2, total = 2),
				),
			),
			listOf(server.records("/auth/session"), prefetcher.urls, reports),
		)
	}

	@Test
	fun `a current version whose stored copy is too old to show is fetched again`() = runTest {
		val manifestDirectory = folder.newFolder()
		writeManifest(manifestDirectory, mapOf("a1" to "v1", "a2" to "v2"))
		val copies = folder.newFolder()
		readerCopy(copies).record(readerUrl("a1"))
		val later = readerCopy(copies, now = Instant.EPOCH.plus(OfflineCopy.MAXIMUM_AGE).plusSeconds(1))
		later.record(readerUrl("a2"))
		server.handle(
			listing(listOf(listOf(Fixtures.article("a1", contentVersion = "v1"), Fixtures.article("a2", contentVersion = "v2")))),
		)
		val prefetcher = RecordingPrefetcher()

		download(prefetcher, manifest = manifest(manifestDirectory), readerCopy = later).run(START) {}

		assertEquals(listOf(listOf(readerUrl("a1")), true), listOf(prefetcher.urls, later.isShowable(readerUrl("a1"))))
	}

	@Test
	fun `a run after the offline files were deleted fetches every article again`() = runTest {
		val directory = folder.newFolder()
		server.handle(
			listing(listOf(listOf(Fixtures.article("a1", contentVersion = "v1"), Fixtures.article("a2", contentVersion = "v2")))),
		)
		val manifest = manifest(directory)
		val copies = readerCopy()
		download(RecordingPrefetcher(), manifest = manifest, readerCopy = copies).run(START) {}
		directory.deleteRecursively()
		val prefetcher = RecordingPrefetcher()

		download(prefetcher, manifest = manifest, readerCopy = copies).run(START) {}

		assertEquals(listOf(readerUrl("a1"), readerUrl("a2")), prefetcher.urls)
	}

	@Test
	fun `a cancelled prefetch records nothing in the manifest`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1", contentVersion = "v1")))))
		val prefetcher = object : ReaderPrefetching {
			val urls = mutableListOf<String>()

			override suspend fun prefetch(url: String, cookies: List<Cookie>): Boolean {
				urls += url
				awaitCancellation()
			}
		}
		val manifest = manifest()

		val run = launch { download(prefetcher, manifest = manifest).run(START) {} }
		runCurrent()
		val started = prefetcher.urls.toList()
		run.cancel()
		run.join()
		runCurrent()

		assertEquals(
			listOf(listOf(readerUrl("a1")), DownloadedVersions(emptyMap())),
			listOf(started, manifest.versions.value),
		)
	}

	@Test
	fun `a run whose prefetch was refused counts it as not stored`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"), Fixtures.article("a2")))))
		val reports = mutableListOf<OfflineDownloadProgress>()

		val outcome = download(RecordingPrefetcher(answer = { it != readerUrl("a2") })).run(START) { reports += it }

		assertEquals(
			listOf(OfflineDownloadOutcome.PartiallyDownloaded(failed = 1, total = 2), OfflineDownloadProgress(completed = 2, total = 2)),
			listOf(outcome, reports.last()),
		)
	}

	@Test
	fun `a run that stores every article forgets its record`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"), Fixtures.article("a2")))))
		val directory = folder.newFolder()

		val outcome = download(RecordingPrefetcher(), manifest = manifest(directory)).run(START) {}

		assertEquals(
			listOf(OfflineDownloadOutcome.Downloaded, Json.parseToJsonElement("""{"versions":{},"run":null}""")),
			listOf(outcome, Json.parseToJsonElement(File(directory, "download-manifest.json").readText())),
		)
	}

	@Test
	fun `a run with nothing unread clears an older interrupted record`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.readArticle("r1")))))
		val directory = folder.newFolder()
		manifest(directory).recordRun(OfflineDownloadRun(total = 1296, completed = 312))
		val before = manifest(directory).incompleteRun()

		val outcome = download(RecordingPrefetcher(), manifest = manifest(directory)).run(START) {}

		assertEquals(
			listOf(OfflineDownloadRun(total = 1296, completed = 312), OfflineDownloadOutcome.Downloaded, null),
			listOf(before, outcome, manifest(directory).incompleteRun()),
		)
	}

	@Test
	fun `a cancelled run keeps the record of how far it got`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1"), Fixtures.article("a2")))))
		val directory = folder.newFolder()
		val prefetcher = object : ReaderPrefetching {
			override suspend fun prefetch(url: String, cookies: List<Cookie>): Boolean {
				if (url == readerUrl("a2")) awaitCancellation()
				return true
			}
		}

		val run = launch { download(prefetcher, manifest = manifest(directory)).run(START) {} }
		runCurrent()
		run.cancel()
		run.join()
		runCurrent()

		assertEquals(
			listOf(true, OfflineDownloadRun(total = 2, completed = 1)),
			listOf(run.isCancelled, manifest(directory).incompleteRun()),
		)
	}

	@Test
	fun `a run that fails keeps the record of the last progress it reported`() = runTest {
		server.handle { record ->
			val number = record.request.url.queryParameter("page")?.toInt() ?: 1
			when {
				record.path == "/auth/session" -> MINTED
				record.path == "/queue" && number == 1 -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")), next = "/queue?page=2"))
				else -> Stub.json(500, "{}")
			}
		}
		val directory = folder.newFolder()
		val prefetcher = object : ReaderPrefetching {
			override suspend fun prefetch(url: String, cookies: List<Cookie>): Boolean = awaitCancellation()
		}
		val reports = mutableListOf<OfflineDownloadProgress>()

		val failure = runCatching { download(prefetcher, manifest = manifest(directory)).run(START) { reports += it } }.exceptionOrNull()

		assertEquals(
			listOf(500, OfflineDownloadProgress(completed = 0, total = 1), OfflineDownloadRun(total = 1, completed = 0)),
			listOf(failure.let { if (it is ApiError.Server) it.status else null }, reports.last(), manifest(directory).incompleteRun()),
		)
	}

	private object Fixtures {
		fun article(id: String, readLink: Boolean = true, processing: Boolean = false, contentVersion: String? = null): String {
			val links = if (readLink) """[{ "rel": ["read"], "href": "/queue/$id/view" }]""" else "[]"
			val processingProperty = if (processing) {
				""", "processing": { "label": "Processing", "refresh": { "href": "/queue/$id", "afterSeconds": 3 } }"""
			} else {
				""
			}
			val versionProperty = if (contentVersion != null) """, "contentVersion": "$contentVersion"""" else ""
			return """
				{
					"class": ["article"],
					"rel": ["item"],
					"properties": { "id": "$id", "url": "https://example.com/$id", "title": "$id", "status": "unread"$processingProperty$versionProperty },
					"links": $links
				}
			"""
		}

		fun readArticle(id: String): String =
			"""
				{
					"class": ["article"],
					"rel": ["item"],
					"properties": { "id": "$id", "url": "https://example.com/$id", "status": "read", "isRead": true },
					"links": [{ "rel": ["read"], "href": "/queue/$id/view" }]
				}
			"""

		fun collection(entities: List<String>, next: String?, nextMarked: Boolean = false): String {
			val nextClass = if (nextMarked) """, "class": ["offline-prefetch"]""" else ""
			val nextLink = if (next != null) """, { "rel": ["next"], "href": "$next"$nextClass }""" else ""
			return """
				{
					"class": ["collection", "articles"],
					"properties": { "total": ${entities.size}, "pageSize": 20 },
					"entities": [${entities.joinToString(",\n")}],
					"links": [{ "rel": ["root"], "href": "/queue" }$nextLink],
					"actions": []
				}
			"""
		}
	}

	private companion object {
		const val USER_AGENT = "Readplace/1 Android/16"
		val START = OfflineDownloadRequest(startHref = "/queue", sessionAction = null)
		val MINTED = Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=sess-1; Path=/; HttpOnly"))
	}
}
