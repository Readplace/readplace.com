package com.readplace.android.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class UploadFileChooserTest {
	private val server = "https://readplace.com"

	@Test
	fun `the picker opens only on the service's own upload pages`() {
		assertEquals(
			listOf(true, true, false, false, false, false, false),
			listOf(
				"https://readplace.com/upload",
				"https://readplace.com/upload/abc/received",
				"https://readplace.com/uploads-elsewhere",
				"https://readplace.com/queue/a1/view",
				"https://evil.example/upload",
				"http://readplace.com/upload",
				"https://readplace.com:8443/upload",
			).map { UploadFileChooser.accepts(it, server, isChoosing = false) },
		)
	}

	@Test
	fun `a second request while one choice is pending is refused`() {
		assertEquals(false, UploadFileChooser.accepts("https://readplace.com/upload", server, isChoosing = true))
	}

	@Test
	fun `a page with no url never opens the picker`() {
		assertEquals(false, UploadFileChooser.accepts(null, server, isChoosing = false))
	}

	@Test
	fun `the accepted types become the picker's mime types, and extensions alone fall back to any file`() {
		assertArrayEquals(arrayOf("application/epub+zip", "application/pdf"), UploadFileChooser.mimeTypes(arrayOf("application/epub+zip, application/pdf")))
		assertArrayEquals(arrayOf("*/*"), UploadFileChooser.mimeTypes(arrayOf(".epub")))
		assertArrayEquals(arrayOf("*/*"), UploadFileChooser.mimeTypes(null))
	}
}
