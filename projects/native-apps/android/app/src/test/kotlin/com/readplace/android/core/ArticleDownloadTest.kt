package com.readplace.android.core

import java.net.URI
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
}
