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
	fun `returns null when there is no web url`() {
		assertNull(UrlDetection.firstWebUrl("no links here"))
	}
}
