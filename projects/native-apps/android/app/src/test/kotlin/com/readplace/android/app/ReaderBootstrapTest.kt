package com.readplace.android.app

import com.readplace.android.core.StoredReaderPage
import okhttp3.Cookie
import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderBootstrapTest {
	@Test
	fun `a minted session is ready with its cookies`() {
		val cookie = sessionCookie()

		assertEquals(
			ReaderBootstrap.Ready(listOf(cookie)),
			ReaderBootstrap.after(ReaderSessionMint.Minted(listOf(cookie))),
		)
	}

	@Test
	fun `a failed mint is unavailable`() {
		assertEquals(ReaderBootstrap.Unavailable, ReaderBootstrap.after(ReaderSessionMint.Failed))
	}

	@Test
	fun `a superseded mint stays loading so the next appearance retries`() {
		assertEquals(
			"a mint cancelled by an article switch must leave the bootstrap retryable, " +
				"not \"Couldn't open the reader\"",
			ReaderBootstrap.Loading,
			ReaderBootstrap.after(ReaderSessionMint.Superseded),
		)
	}

	@Test
	fun `a minted session opens with the protocol cache and no banner`() {
		val cookie = sessionCookie()

		val ready = ReaderBootstrap.Ready(listOf(cookie))

		assertEquals(ready, ReaderBootstrap.after(ReaderSessionMint.Minted(listOf(cookie))))
		assertEquals(
			Triple(listOf(cookie), ReaderCacheMode.PROTOCOL, false),
			Triple(ready.cookies, ready.cacheMode, ready.showsOfflineBanner),
		)
	}

	@Test
	fun `an offline mint opens the stored copy with the banner and no cookies`() {
		assertEquals(ReaderBootstrap.Offline, ReaderBootstrap.after(ReaderSessionMint.Offline))
		assertEquals(
			Triple(emptyList<Cookie>(), ReaderCacheMode.STORED_COPY_FIRST, true),
			Triple(
				ReaderBootstrap.Offline.cookies,
				ReaderBootstrap.Offline.cacheMode,
				ReaderBootstrap.Offline.showsOfflineBanner,
			),
		)
	}

	@Test
	fun `an offline open with no showable copy is offline unavailable`() {
		assertEquals(
			"a stored copy older than 30 days, or of unknown age, is not opened",
			ReaderBootstrap.OfflineUnavailable,
			ReaderBootstrap.shown(ReaderBootstrap.Offline, offlineSource = ReaderOfflineSource.Missing),
		)
	}

	@Test
	fun `an offline open with a kept page or a cache record opens it`() {
		assertEquals(
			listOf(ReaderBootstrap.Offline, ReaderBootstrap.Offline),
			OPENABLE.map { ReaderBootstrap.shown(ReaderBootstrap.Offline, offlineSource = it) },
		)
	}

	@Test
	fun `an online open never depends on a record`() {
		val ready = ReaderBootstrap.Ready(listOf(sessionCookie()))

		assertEquals(
			"an online open never depends on a record",
			listOf(ready, ready),
			listOf(
				ReaderBootstrap.shown(ready, offlineSource = ReaderOfflineSource.Missing),
				ReaderBootstrap.shown(ready, offlineSource = OPENABLE.first()),
			),
		)
	}

	@Test
	fun `a value that opens nothing is shown unchanged`() {
		val unopened = listOf(ReaderBootstrap.Loading, ReaderBootstrap.Unavailable, ReaderBootstrap.OfflineUnavailable)

		assertEquals(
			unopened + unopened,
			unopened.map { ReaderBootstrap.shown(it, offlineSource = ReaderOfflineSource.Missing) } +
				unopened.map { ReaderBootstrap.shown(it, offlineSource = OPENABLE.first()) },
		)
	}

	private fun sessionCookie(): Cookie =
		Cookie.Builder()
			.name("hutch_sid")
			.value("sess-xyz")
			.domain("readplace.com")
			.path("/")
			.build()

	private companion object {
		val OPENABLE = listOf(
			ReaderOfflineSource.Kept(
				StoredReaderPage(
					savedAt = java.time.Instant.EPOCH,
					articleId = "a1",
					contentVersion = "v1",
					contentType = "text/html",
					contentSecurityPolicy = null,
					body = ByteArray(1),
				),
			),
			ReaderOfflineSource.CacheRecord,
		)
	}
}
