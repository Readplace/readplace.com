package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
	fun `encodes a caret so a link a browser opens is no longer rejected`() {
		assertEquals(
			"https://example.com/a%5Eb",
			UrlDetection.firstWebUrl("look at https://example.com/a^b now"),
		)
	}

	@Test
	fun `encodes a pipe in a shared url found in prose`() {
		assertEquals(
			"https://example.com/a%7Cb",
			UrlDetection.firstWebUrl("open https://example.com/a|b please"),
		)
	}

	@Test
	fun `encodes a caret in a query value found in prose`() {
		assertEquals(
			"https://example.com/s?q=a%5Eb",
			UrlDetection.firstWebUrl("try https://example.com/s?q=a^b today"),
		)
	}

	@Test
	fun `drops a trailing full stop before encoding a caret`() {
		assertEquals(
			"https://example.com/a%5Eb",
			UrlDetection.firstWebUrl("Read https://example.com/a^b. Then stop"),
		)
	}

	@Test
	fun `keeps a balanced bracket the url opened and encodes a caret inside it`() {
		assertEquals(
			"https://example.com/path_(a%5Eb)",
			UrlDetection.firstWebUrl("see https://example.com/path_(a^b). Next"),
		)
	}

	@Test
	fun `leaves an already escaped caret untouched in prose`() {
		assertEquals(
			"https://example.com/a%5Eb",
			UrlDetection.firstWebUrl("see https://example.com/a%5Eb here"),
		)
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
	fun `normalizes an http or https url to itself when it has nothing to encode`() {
		assertEquals("http://example.com", UrlDetection.normalizeWebUrl("http://example.com"))
		assertEquals("https://example.com/a.pdf", UrlDetection.normalizeWebUrl("https://example.com/a.pdf"))
	}

	@Test
	fun `normalizes a url whatever case the scheme is written in`() {
		assertEquals("HTTP://EXAMPLE.COM", UrlDetection.normalizeWebUrl("HTTP://EXAMPLE.COM"))
		assertEquals("HttpS://Example.com/a", UrlDetection.normalizeWebUrl("HttpS://Example.com/a"))
	}

	@Test
	fun `encodes a caret in an explicit url path`() {
		assertEquals("https://example.com/a%5Eb", UrlDetection.normalizeWebUrl("https://example.com/a^b"))
	}

	@Test
	fun `encodes a pipe in an explicit url path`() {
		assertEquals("https://example.com/a%7Cb", UrlDetection.normalizeWebUrl("https://example.com/a|b"))
	}

	@Test
	fun `encodes a caret and pipe in a query value and keeps the query delimiters`() {
		assertEquals(
			"https://example.com/s?a=1&b=x%5Ey%7Cz",
			UrlDetection.normalizeWebUrl("https://example.com/s?a=1&b=x^y|z"),
		)
	}

	@Test
	fun `encodes a caret in a fragment`() {
		assertEquals("https://example.com/p#sec%5E1", UrlDetection.normalizeWebUrl("https://example.com/p#sec^1"))
	}

	@Test
	fun `leaves an already escaped caret untouched`() {
		assertEquals("https://example.com/a%5Eb", UrlDetection.normalizeWebUrl("https://example.com/a%5Eb"))
	}

	@Test
	fun `does not normalize a mailto link`() {
		assertNull(UrlDetection.normalizeWebUrl("mailto:me@example.com"))
	}

	@Test
	fun `does not normalize a tel link`() {
		assertNull(UrlDetection.normalizeWebUrl("tel:+15551234567"))
	}

	@Test
	fun `does not normalize a shared file url`() {
		assertNull(UrlDetection.normalizeWebUrl("file:///tmp/shared.pdf"))
	}

	@Test
	fun `does not normalize a content provider url`() {
		assertNull(UrlDetection.normalizeWebUrl("content://com.android.providers.downloads/1"))
	}

	@Test
	fun `does not normalize a value without a scheme`() {
		assertNull(UrlDetection.normalizeWebUrl("no-scheme"))
		assertNull(UrlDetection.normalizeWebUrl(""))
	}

	@Test
	fun `does not normalize a value the uri parser rejects`() {
		assertNull(UrlDetection.normalizeWebUrl("http://exa mple.com"))
	}

	@Test
	fun `still rejects a caret in the authority`() {
		assertNull(UrlDetection.normalizeWebUrl("https://exa^mple.com/a"))
	}

	@Test
	fun `still rejects a pipe in the authority`() {
		assertNull(UrlDetection.normalizeWebUrl("https://exa|mple.com/a"))
	}

	@Test
	fun `still rejects an unescaped control character in the path`() {
		assertNull(UrlDetection.normalizeWebUrl("https://example.com/a\u0001b"))
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
