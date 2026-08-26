package com.readplace.android.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class MultipartFormTest {
	@get:Rule
	val temporaryFolder = TemporaryFolder()

	@Test
	fun `writes every text part before the content part, each framed by the boundary`() {
		val destination = File(temporaryFolder.root, "with-title.multipart")

		MultipartForm(
			boundary = "BOUNDARY-1",
			textParts = listOf(
				MultipartForm.TextPart(name = "url", value = "https://example.com/post"),
				MultipartForm.TextPart(name = "mediaType", value = "text/html"),
				MultipartForm.TextPart(name = "title", value = "Captured"),
			),
			filePart = MultipartForm.FilePart(
				name = "content",
				filename = "content",
				bytes = "<html><body>hi</body></html>".toByteArray(Charsets.UTF_8),
			),
		).writeTo(destination)

		assertEquals(
			"--BOUNDARY-1\r\n" +
				"Content-Disposition: form-data; name=\"url\"\r\n\r\n" +
				"https://example.com/post\r\n" +
				"--BOUNDARY-1\r\n" +
				"Content-Disposition: form-data; name=\"mediaType\"\r\n\r\n" +
				"text/html\r\n" +
				"--BOUNDARY-1\r\n" +
				"Content-Disposition: form-data; name=\"title\"\r\n\r\n" +
				"Captured\r\n" +
				"--BOUNDARY-1\r\n" +
				"Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n" +
				"<html><body>hi</body></html>\r\n" +
				"--BOUNDARY-1--\r\n",
			destination.readBytes().toString(Charsets.UTF_8),
		)
	}

	@Test
	fun `writes the content part alone when there are no text parts`() {
		val destination = File(temporaryFolder.root, "no-text-parts.multipart")

		MultipartForm(
			boundary = "BOUNDARY-2",
			textParts = emptyList(),
			filePart = MultipartForm.FilePart(
				name = "content",
				filename = "content",
				bytes = "%PDF-1.7 body".toByteArray(Charsets.UTF_8),
			),
		).writeTo(destination)

		assertEquals(
			"--BOUNDARY-2\r\n" +
				"Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n" +
				"%PDF-1.7 body\r\n" +
				"--BOUNDARY-2--\r\n",
			destination.readBytes().toString(Charsets.UTF_8),
		)
	}

	@Test
	fun `names the file part and its filename from the part, not from a fixed literal`() {
		val destination = File(temporaryFolder.root, "renamed.multipart")

		MultipartForm(
			boundary = "BOUNDARY-3",
			textParts = emptyList(),
			filePart = MultipartForm.FilePart(
				name = "attachment",
				filename = "paper.pdf",
				bytes = "x".toByteArray(Charsets.UTF_8),
			),
		).writeTo(destination)

		assertEquals(
			"--BOUNDARY-3\r\n" +
				"Content-Disposition: form-data; name=\"attachment\"; filename=\"paper.pdf\"\r\n\r\n" +
				"x\r\n" +
				"--BOUNDARY-3--\r\n",
			destination.readBytes().toString(Charsets.UTF_8),
		)
	}

	@Test
	fun `carries binary content through the framing unaltered`() {
		val content = byteArrayOf(0x00, 0xFF.toByte(), 0x0D, 0x0A, 0x2D, 0x2D)
		val destination = File(temporaryFolder.root, "binary.multipart")

		MultipartForm(
			boundary = "BOUNDARY-4",
			textParts = listOf(MultipartForm.TextPart(name = "mediaType", value = "application/pdf")),
			filePart = MultipartForm.FilePart(name = "content", filename = "content", bytes = content),
		).writeTo(destination)

		assertArrayEquals(
			(
				"--BOUNDARY-4\r\n" +
					"Content-Disposition: form-data; name=\"mediaType\"\r\n\r\n" +
					"application/pdf\r\n" +
					"--BOUNDARY-4\r\n" +
					"Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n"
				).toByteArray(Charsets.UTF_8) +
				content +
				"\r\n--BOUNDARY-4--\r\n".toByteArray(Charsets.UTF_8),
			destination.readBytes(),
		)
	}

	@Test
	fun `encodes a non-ascii text part value as utf-8`() {
		val destination = File(temporaryFolder.root, "utf8.multipart")

		MultipartForm(
			boundary = "BOUNDARY-5",
			textParts = listOf(MultipartForm.TextPart(name = "title", value = "Café ☕")),
			filePart = MultipartForm.FilePart(name = "content", filename = "content", bytes = ByteArray(0)),
		).writeTo(destination)

		assertArrayEquals(
			"--BOUNDARY-5\r\n".toByteArray(Charsets.UTF_8) +
				"Content-Disposition: form-data; name=\"title\"\r\n\r\n".toByteArray(Charsets.UTF_8) +
				byteArrayOf(
					0x43, 0x61, 0x66, 0xC3.toByte(), 0xA9.toByte(), 0x20,
					0xE2.toByte(), 0x98.toByte(), 0x95.toByte(), 0x0D, 0x0A,
				) +
				"--BOUNDARY-5\r\n".toByteArray(Charsets.UTF_8) +
				"Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n".toByteArray(Charsets.UTF_8) +
				"\r\n--BOUNDARY-5--\r\n".toByteArray(Charsets.UTF_8),
			destination.readBytes(),
		)
	}

	@Test
	fun `puts the same bytes in memory as it puts in the staged file`() {
		val destination = File(temporaryFolder.root, "same-bytes.multipart")
		val form = MultipartForm(
			boundary = "BOUNDARY-6",
			textParts = listOf(
				MultipartForm.TextPart(name = "url", value = "https://example.com/post"),
				MultipartForm.TextPart(name = "mediaType", value = "text/html"),
			),
			filePart = MultipartForm.FilePart(
				name = "content",
				filename = "content",
				bytes = "<html><body>hi</body></html>".toByteArray(Charsets.UTF_8),
			),
		)

		form.writeTo(destination)

		assertArrayEquals(destination.readBytes(), form.body())
		assertEquals(
			"--BOUNDARY-6\r\n" +
				"Content-Disposition: form-data; name=\"url\"\r\n\r\n" +
				"https://example.com/post\r\n" +
				"--BOUNDARY-6\r\n" +
				"Content-Disposition: form-data; name=\"mediaType\"\r\n\r\n" +
				"text/html\r\n" +
				"--BOUNDARY-6\r\n" +
				"Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n" +
				"<html><body>hi</body></html>\r\n" +
				"--BOUNDARY-6--\r\n",
			form.body().toString(Charsets.UTF_8),
		)
	}

	@Test
	fun `truncates a longer body left at the destination`() {
		val destination = temporaryFolder.newFile("reused.multipart")
		destination.writeBytes(ByteArray(4096) { 0x41.toByte() })

		MultipartForm(
			boundary = "BOUNDARY-7",
			textParts = listOf(MultipartForm.TextPart(name = "url", value = "https://example.com/post")),
			filePart = MultipartForm.FilePart(
				name = "content",
				filename = "content",
				bytes = "short".toByteArray(Charsets.UTF_8),
			),
		).writeTo(destination)

		assertEquals(
			"--BOUNDARY-7\r\n" +
				"Content-Disposition: form-data; name=\"url\"\r\n\r\n" +
				"https://example.com/post\r\n" +
				"--BOUNDARY-7\r\n" +
				"Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n" +
				"short\r\n" +
				"--BOUNDARY-7--\r\n",
			destination.readBytes().toString(Charsets.UTF_8),
		)
	}

	@Test
	fun `declares the boundary in its content type`() {
		val form = MultipartForm(
			boundary = "abc-123",
			textParts = emptyList(),
			filePart = MultipartForm.FilePart(name = "content", filename = "content", bytes = ByteArray(0)),
		)

		assertEquals("multipart/form-data; boundary=abc-123", form.contentType)
	}
}
