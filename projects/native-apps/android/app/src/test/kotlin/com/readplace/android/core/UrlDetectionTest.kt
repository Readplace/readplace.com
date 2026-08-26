package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlDetectionTest {
	@Test
	fun `finds an https url surrounded by prose`() {
		assertEquals(
			"https://example.com/post",
			UrlDetection.firstWebUrl("check https://example.com/post out"),
		)
	}

	@Test
	fun `finds an http url that is the whole text`() {
		assertEquals("http://example.com", UrlDetection.firstWebUrl("http://example.com"))
	}

	@Test
	fun `takes the first of several web urls`() {
		assertEquals(
			"https://one.example.com/a",
			UrlDetection.firstWebUrl("https://one.example.com/a beats https://two.example.com/b"),
		)
	}

	@Test
	fun `finds no url in a bare email address`() {
		assertNull(UrlDetection.firstWebUrl("email me at someone@example.com"))
	}

	@Test
	fun `finds no url in a mailto link`() {
		assertNull(UrlDetection.firstWebUrl("write to mailto:me@example.com"))
	}

	@Test
	fun `finds no url in a phone number`() {
		assertNull(UrlDetection.firstWebUrl("call +1 (555) 123-4567 now"))
	}

	@Test
	fun `rejects a shared file url`() {
		assertNull(UrlDetection.firstWebUrl("open file:///tmp/shared.pdf now"))
	}

	@Test
	fun `rejects a content provider url`() {
		assertNull(UrlDetection.firstWebUrl("from content://com.android.providers.downloads/1"))
	}

	@Test
	fun `rejects a candidate no uri parser accepts`() {
		assertNull(UrlDetection.firstWebUrl("look at https://example.com/a^b now"))
	}

	@Test
	fun `skips a non web scheme and picks the web url after it`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("file:///tmp/shared.pdf came with https://example.com/a"),
		)
	}

	@Test
	fun `finds no url in plain text`() {
		assertNull(UrlDetection.firstWebUrl("just some plain text"))
	}

	@Test
	fun `finds no url in empty text`() {
		assertNull(UrlDetection.firstWebUrl(""))
	}

	@Test
	fun `is a web url for http and https`() {
		assertTrue(UrlDetection.isWebUrl("http://example.com"))
		assertTrue(UrlDetection.isWebUrl("https://example.com/a.pdf"))
	}

	@Test
	fun `is a web url whatever case the scheme is written in`() {
		assertTrue(UrlDetection.isWebUrl("HTTP://EXAMPLE.COM"))
		assertTrue(UrlDetection.isWebUrl("HttpS://Example.com/a"))
	}

	@Test
	fun `is not a web url for mailto`() {
		assertFalse(UrlDetection.isWebUrl("mailto:me@example.com"))
	}

	@Test
	fun `is not a web url for tel`() {
		assertFalse(UrlDetection.isWebUrl("tel:+15551234567"))
	}

	@Test
	fun `is not a web url for a shared file`() {
		assertFalse(UrlDetection.isWebUrl("file:///tmp/shared.pdf"))
	}

	@Test
	fun `is not a web url for a content provider`() {
		assertFalse(UrlDetection.isWebUrl("content://com.android.providers.downloads/1"))
	}

	@Test
	fun `is not a web url without a scheme`() {
		assertFalse(UrlDetection.isWebUrl("no-scheme"))
		assertFalse(UrlDetection.isWebUrl(""))
	}

	@Test
	fun `is not a web url when the value does not parse`() {
		assertFalse(UrlDetection.isWebUrl("http://exa mple.com"))
	}

	@Test
	fun `keeps a url that ends in a character prose never adds`() {
		assertEquals(
			"https://example.com/post",
			UrlDetection.firstWebUrl("https://example.com/post"),
		)
	}

	@Test
	fun `drops a full stop that ends the sentence`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("Read https://example.com/a. Then stop"),
		)
	}

	@Test
	fun `drops a comma that continues the sentence`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("Read https://example.com/a, then stop"),
		)
	}

	@Test
	fun `drops a semicolon that joins the sentence`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("Read https://example.com/a; then stop"),
		)
	}

	@Test
	fun `drops a colon that introduces what follows`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("Read https://example.com/a: it is good"),
		)
	}

	@Test
	fun `drops an exclamation mark`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("Read https://example.com/a!"),
		)
	}

	@Test
	fun `drops a question mark`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("Seen https://example.com/a?"),
		)
	}

	@Test
	fun `drops every trailing punctuation mark in a run`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("Seen https://example.com/a?!,"),
		)
	}

	@Test
	fun `keeps a query string and drops only the punctuation after it`() {
		assertEquals(
			"https://example.com/a?q=1",
			UrlDetection.firstWebUrl("Read https://example.com/a?q=1."),
		)
	}

	@Test
	fun `keeps a closing round bracket the url itself opened`() {
		assertEquals(
			"https://en.wikipedia.org/wiki/Foo_(bar)",
			UrlDetection.firstWebUrl("read https://en.wikipedia.org/wiki/Foo_(bar) now"),
		)
	}

	@Test
	fun `drops a closing round bracket nothing in the url opened`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("(https://example.com/a)"),
		)
	}

	@Test
	fun `keeps a closing square bracket the url itself opened`() {
		assertEquals(
			"https://[::1]",
			UrlDetection.firstWebUrl("ping https://[::1] now"),
		)
	}

	@Test
	fun `drops a closing square bracket nothing in the url opened`() {
		assertEquals(
			"https://example.com/a",
			UrlDetection.firstWebUrl("see [https://example.com/a]"),
		)
	}
}
