package com.readplace.android.app

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

	private fun sessionCookie(): Cookie =
		Cookie.Builder()
			.name("hutch_sid")
			.value("sess-xyz")
			.domain("readplace.com")
			.path("/")
			.build()
}
