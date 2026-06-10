package com.readplace.poc.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class UrlDetectionTest {
	@Test
	fun `extracts the first http(s) url from prose`() {
		assertEquals("https://example.com/post", UrlDetection.firstWebUrl("Check https://example.com/post out"))
	}

	@Test
	fun `ignores non-web schemes`() {
		assertNull(UrlDetection.firstWebUrl("Email mailto:a@b.com or call tel:+15551234"))
	}

	@Test
	fun `strips trailing sentence punctuation`() {
		assertEquals("http://a.test", UrlDetection.firstWebUrl("Visit http://a.test."))
		assertEquals("https://a.test/x", UrlDetection.firstWebUrl("(see https://a.test/x)"))
	}

	@Test
	fun `keeps balanced parentheses that are part of the path`() {
		assertEquals(
			"https://en.wikipedia.org/wiki/Foo_(bar)",
			UrlDetection.firstWebUrl("Read https://en.wikipedia.org/wiki/Foo_(bar) today"),
		)
	}

	@Test
	fun `strips only the unmatched paren when a paren-path url is itself parenthesised`() {
		assertEquals(
			"https://en.wikipedia.org/wiki/Foo_(bar)",
			UrlDetection.firstWebUrl("(see https://en.wikipedia.org/wiki/Foo_(bar))"),
		)
	}

	@Test
	fun `returns null when there is no web url`() {
		assertNull(UrlDetection.firstWebUrl("no links here"))
	}
}
