package com.readplace.android.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ShareExtractorTest {
	private class RecordingPdf(override val suggestedName: String?) : SharedPdf {
		var reads = 0

		override suspend fun bytes(maxBytes: Long): ByteArray? {
			reads++
			return null
		}
	}

	private fun item(
		contentText: String? = null,
		urls: List<String> = emptyList(),
		texts: List<String> = emptyList(),
		pdfs: List<SharedPdf> = emptyList(),
	): SharedItem = SharedItem(contentText = contentText, urls = urls, texts = texts, pdfs = pdfs)

	private fun items(vararg items: SharedItem): SharedItems = SharedItems(items.toList())

	@Test
	fun `extracts a web url`() {
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/post", title = null, pdf = null),
			ShareExtractor.extract(items(item(urls = listOf("https://example.com/post")))),
		)
	}

	@Test
	fun `extracts a url from plain text, which is not a title`() {
		assertEquals(
			"a plain-text attachment is where the URL is found, never where the title comes from",
			ShareExtractor.Shared(url = "https://example.com/p", title = null, pdf = null),
			ShareExtractor.extract(items(item(texts = listOf("read this https://example.com/p ok")))),
		)
	}

	@Test
	fun `ignores a non web url`() {
		assertNull(
			"a mailto link is not a web URL and there is no PDF, so nothing is saveable",
			ShareExtractor.extract(items(item(urls = listOf("mailto:a@b.com")))),
		)
	}

	@Test
	fun `ignores the content url a pdf arrives under and keeps the pdf`() {
		val pdf = RecordingPdf(suggestedName = "doc.pdf")
		assertEquals(
			ShareExtractor.Shared(url = null, title = "doc.pdf", pdf = pdf),
			ShareExtractor.extract(
				items(item(urls = listOf("content://com.android.chrome.FileProvider/doc.pdf"), pdfs = listOf(pdf))),
			),
		)
	}

	@Test
	fun `takes the first web url when a non web one precedes it`() {
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/second", title = null, pdf = null),
			ShareExtractor.extract(items(item(urls = listOf("mailto:a@b.com", "https://example.com/second")))),
		)
	}

	@Test
	fun `within one item a shared url beats a url inside its text`() {
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/u", title = null, pdf = null),
			ShareExtractor.extract(
				items(item(texts = listOf("see https://example.com/t"), urls = listOf("https://example.com/u"))),
			),
		)
	}

	@Test
	fun `an earlier item's text url outranks a later item's url attachment`() {
		// The order is per item, the way the iOS extension walks its extension items:
		// item 1's attachments, then item 1's text, before item 2 is looked at at all.
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/t", title = null, pdf = null),
			ShareExtractor.extract(
				items(
					item(texts = listOf("see https://example.com/t")),
					item(urls = listOf("https://example.com/u")),
				),
			),
		)
	}

	@Test
	fun `finds the url in a later item when the first has none`() {
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/t", title = null, pdf = null),
			ShareExtractor.extract(
				items(item(texts = listOf("no link here")), item(texts = listOf("see https://example.com/t"))),
			),
		)
	}

	@Test
	fun `finds url and pdf across separate items`() {
		val pdf = RecordingPdf(suggestedName = "doc.pdf")
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/a", title = "doc.pdf", pdf = pdf),
			ShareExtractor.extract(items(item(urls = listOf("https://example.com/a")), item(pdfs = listOf(pdf)))),
		)
	}

	@Test
	fun `title comes from the item's own caption`() {
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/a", title = "My Title", pdf = null),
			ShareExtractor.extract(items(item(contentText = "My Title", urls = listOf("https://example.com/a")))),
		)
	}

	@Test
	fun `the first captioned item names the share`() {
		assertEquals(
			ShareExtractor.Shared(url = "https://example.com/a", title = "Second caption", pdf = null),
			ShareExtractor.extract(
				items(
					item(urls = listOf("https://example.com/a")),
					item(contentText = "Second caption"),
					item(contentText = "Third caption"),
				),
			),
		)
	}

	@Test
	fun `title falls back to the pdf suggested name when nothing was captioned`() {
		val pdf = RecordingPdf(suggestedName = "report.pdf")
		assertEquals(
			ShareExtractor.Shared(url = null, title = "report.pdf", pdf = pdf),
			ShareExtractor.extract(items(item(pdfs = listOf(pdf)))),
		)
	}

	@Test
	fun `title is null when nothing was captioned and the pdf has no name`() {
		val pdf = RecordingPdf(suggestedName = null)
		assertEquals(
			ShareExtractor.Shared(url = null, title = null, pdf = pdf),
			ShareExtractor.extract(items(item(pdfs = listOf(pdf)))),
		)
	}

	@Test
	fun `takes the first pdf`() {
		val first = RecordingPdf(suggestedName = "first.pdf")
		val second = RecordingPdf(suggestedName = "second.pdf")
		assertSame(first, ShareExtractor.extract(items(item(pdfs = listOf(first, second))))?.pdf)
	}

	@Test
	fun `does not read the pdf bytes`() {
		val pdf = RecordingPdf(suggestedName = "doc.pdf")
		ShareExtractor.extract(items(item(urls = listOf("https://example.com/a"), pdfs = listOf(pdf))))
		assertEquals("the bytes are read only after the save guards pass", 0, pdf.reads)
	}

	@Test
	fun `returns null when no url and no pdf`() {
		assertNull(ShareExtractor.extract(items(item(texts = listOf("just words, no link")))))
	}

	@Test
	fun `returns null for no items`() {
		assertNull(ShareExtractor.extract(items()))
	}
}
