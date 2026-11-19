package com.readplace.android.app

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Gate
import com.readplace.android.RecordingServer.Record
import com.readplace.android.RecordingServer.Stub
import com.readplace.android.core.AccessToken
import com.readplace.android.core.ApiError
import com.readplace.android.core.EphemeralCookieJar
import com.readplace.android.core.OAuth
import com.readplace.android.core.OAuthTokens
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
import okhttp3.Cookie
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
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
		ioDispatcher: CoroutineDispatcher = StandardTestDispatcher(testScheduler),
	): DownloadUnreadOffline = DownloadUnreadOffline(api(ioDispatcher), snapshot, prefetcher)

	private fun readerUrl(id: String): String = "${server.baseUrl}/queue/$id/view?platform=android"

	private fun listing(pages: List<List<String>>, gate: Gate? = null, mint: Stub = MINTED): (Record) -> Stub = { record ->
		val number = record.request.url.queryParameter("page")?.toInt() ?: 1
		when {
			record.path == "/auth/session" -> mint
			record.path == "/queue" && number == 2 && gate != null -> gate.holding(Stub.json(200, page(pages, number)))
			record.path == "/queue" && number <= pages.size -> Stub.json(200, page(pages, number))
			else -> Stub.json(404, "{}")
		}
	}

	private fun page(pages: List<List<String>>, number: Int): String =
		Fixtures.collection(pages[number - 1], next = if (number < pages.size) "/queue?page=${number + 1}" else null)

	private fun pageHeaders(): List<Pair<String?, String?>> =
		server.records("/queue").map { it.request.url.queryParameter("page") to it.header("Sec-Purpose") }

	@Test
	fun `listing pages after the second are loaded as a prefetch`() = runTest {
		server.handle(listing(listOf(listOf(Fixtures.article("a1")), listOf(Fixtures.article("a2")), listOf(Fixtures.article("a3")))))

		download(RecordingPrefetcher()).run(START) {}

		assertEquals(listOf(null to null, "2" to null, "3" to "prefetch"), pageHeaders())
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

	private object Fixtures {
		fun article(id: String, readLink: Boolean = true, processing: Boolean = false): String {
			val links = if (readLink) """[{ "rel": ["read"], "href": "/queue/$id/view" }]""" else "[]"
			val processingProperty = if (processing) {
				""", "processing": { "label": "Processing", "refresh": { "href": "/queue/$id", "afterSeconds": 3 } }"""
			} else {
				""
			}
			return """
				{
					"class": ["article"],
					"rel": ["item"],
					"properties": { "id": "$id", "url": "https://example.com/$id", "title": "$id", "status": "unread"$processingProperty },
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

		fun collection(entities: List<String>, next: String?): String {
			val nextLink = if (next != null) """, { "rel": ["next"], "href": "$next" }""" else ""
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
