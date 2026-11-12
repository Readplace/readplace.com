package com.readplace.android.core

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticleDownloadTest {
	/** Derived from the flavor under test rather than hard-coded, so the same test
	 * runs against production, staging and local builds. */
	private val serverOrigin = AppConfig.serverBaseUrl.trimEnd('/')

	private val foreignOrigin =
		if (URI(serverOrigin).host == "example.com") "https://other.test" else "https://example.com"

	@Test
	fun recognisesOurOwnEpubLink() {
		assertTrue(isArticleDownloadUrl("$serverOrigin/view/example.com/a?format=epub"))
	}

	@Test
	fun recognisesTheLinkAlongsideItsTrackingParameters() {
		assertTrue(
			isArticleDownloadUrl(
				"$serverOrigin/view/example.com/a?format=epub&utm_source=reader&utm_medium=internal",
			),
		)
	}

	@Test
	fun rejectsAnotherHostsEpubRoute() {
		assertFalse(isArticleDownloadUrl("$foreignOrigin/view?format=epub"))
	}

	@Test
	fun rejectsOurOwnNonDownloadPage() {
		assertFalse(isArticleDownloadUrl("$serverOrigin/view/example.com/a"))
	}

	@Test
	fun rejectsAnotherFormat() {
		assertFalse(isArticleDownloadUrl("$serverOrigin/view/example.com/a?format=pdf"))
	}

	@Test
	fun rejectsAQueryThatMerelyContainsTheParameterName() {
		assertFalse(isArticleDownloadUrl("$serverOrigin/view/example.com/a?other=format=epub"))
	}

	@Test
	fun rejectsASchemeWithNoHost() {
		assertFalse(isArticleDownloadUrl("readplace://reader/close"))
	}

	/** `java.net.URI` rejects characters a browser accepts, and an unparseable
	 * target is not a download claim. */
	@Test
	fun rejectsAnUnparseableUrl() {
		assertFalse(isArticleDownloadUrl("https://readplace.com/a b?format=epub"))
	}

	private val ownEpub = "$serverOrigin/view/example.com/a?format=epub"

	@Test
	fun sendsTheStoredCookiesWithOurOwnEpubLink() {
		assertEquals(
			mapOf("User-Agent" to "UA", "Cookie" to "hutch_sid=abc; seen=1"),
			articleDownloadHeaders(
				url = ownEpub,
				userAgent = "UA",
				cookiesFor = { if (it == ownEpub) "hutch_sid=abc; seen=1" else null },
			),
		)
	}

	@Test
	fun sendsNoCookieWhenTheStoreHoldsNone() {
		assertEquals(
			mapOf("User-Agent" to "UA"),
			articleDownloadHeaders(url = ownEpub, userAgent = "UA", cookiesFor = { null }),
		)
	}

	@Test
	fun sendsNoCookieWhenTheStoreAnswersBlank() {
		assertEquals(
			mapOf("User-Agent" to "UA"),
			articleDownloadHeaders(url = ownEpub, userAgent = "UA", cookiesFor = { "" }),
		)
	}

	@Test
	fun sendsNoCookieToAnotherHostsEpubRoute() {
		assertEquals(
			mapOf("User-Agent" to "UA"),
			articleDownloadHeaders(
				url = "$foreignOrigin/view/example.com/a?format=epub",
				userAgent = "UA",
				cookiesFor = { "hutch_sid=abc" },
			),
		)
	}

	@Test
	fun sendsNoCookieWithOurOwnNonDownloadPage() {
		assertEquals(
			mapOf("User-Agent" to "UA"),
			articleDownloadHeaders(
				url = "$serverOrigin/view/example.com/a",
				userAgent = "UA",
				cookiesFor = { "hutch_sid=abc" },
			),
		)
	}

	@Test
	fun leavesTheUserAgentToTheDownloaderWhenNoneIsGiven() {
		assertEquals(
			mapOf("Cookie" to "hutch_sid=abc"),
			articleDownloadHeaders(url = ownEpub, userAgent = null, cookiesFor = { "hutch_sid=abc" }),
		)
	}
}
