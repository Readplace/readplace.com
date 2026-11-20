package com.readplace.android.app

import com.readplace.android.core.StoredReaderPage
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class StoredReaderReplayTest {
	private val readerUrl = "https://readplace.com/queue/a1/view?platform=android"

	private fun kept(contentType: String = "text/html; charset=utf-8", csp: String? = "frame-ancestors 'self'"): ReaderOfflineSource.Kept =
		ReaderOfflineSource.Kept(
			StoredReaderPage(
				savedAt = Instant.EPOCH,
				articleId = "a1",
				contentVersion = "v1",
				contentType = contentType,
				contentSecurityPolicy = csp,
				body = "<p>Body</p>".toByteArray(),
			),
		)

	private fun document(url: String = readerUrl, method: String = "GET", isMainFrame: Boolean = true): ReaderResourceRequest =
		ReaderResourceRequest(url = url, method = method, isMainFrame = isMainFrame)

	private fun ReplayedReaderPage?.described(): List<Any?>? = this?.let { listOf(it.mimeType, it.encoding, it.headers, String(it.body)) }

	@Test
	fun `the reader document opened from a kept page replays its body and both headers`() {
		val replayed = StoredReaderReplay.of(document(), readerUrl = readerUrl, cacheMode = ReaderCacheMode.STORED_COPY_FIRST, source = kept())

		assertEquals(
			listOf(
				"text/html",
				"utf-8",
				mapOf("Content-Type" to "text/html; charset=utf-8", "Content-Security-Policy" to "frame-ancestors 'self'"),
				"<p>Body</p>",
			),
			replayed.described(),
		)
	}

	@Test
	fun `a kept page without a charset or a policy replays only what it holds`() {
		val replayed = StoredReaderReplay.of(
			document(),
			readerUrl = readerUrl,
			cacheMode = ReaderCacheMode.STORED_COPY_FIRST,
			source = kept(contentType = "text/html", csp = null),
		)

		assertEquals(listOf("text/html", null, mapOf("Content-Type" to "text/html"), "<p>Body</p>"), replayed.described())
	}

	@Test
	fun `everything but the reader document in stored-copy mode with a kept page goes to the network`() {
		val passedThrough = listOf(
			StoredReaderReplay.of(document(), readerUrl = readerUrl, cacheMode = ReaderCacheMode.PROTOCOL, source = kept()),
			StoredReaderReplay.of(document(), readerUrl = readerUrl, cacheMode = ReaderCacheMode.STORED_COPY_FIRST, source = ReaderOfflineSource.CacheRecord),
			StoredReaderReplay.of(document(), readerUrl = readerUrl, cacheMode = ReaderCacheMode.STORED_COPY_FIRST, source = ReaderOfflineSource.Missing),
			StoredReaderReplay.of(document(isMainFrame = false), readerUrl = readerUrl, cacheMode = ReaderCacheMode.STORED_COPY_FIRST, source = kept()),
			StoredReaderReplay.of(document(method = "POST"), readerUrl = readerUrl, cacheMode = ReaderCacheMode.STORED_COPY_FIRST, source = kept()),
			StoredReaderReplay.of(
				document(url = "https://readplace.com/queue/a2/view?platform=android"),
				readerUrl = readerUrl,
				cacheMode = ReaderCacheMode.STORED_COPY_FIRST,
				source = kept(),
			),
		)

		assertEquals(List(6) { null }, passedThrough)
	}
}
