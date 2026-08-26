package com.readplace.android.core

import java.io.File
import java.io.FileOutputStream

/**
 * A `multipart/form-data` body — the text parts, then one file part — in the
 * order the server's parser expects. Kept apart from any request so the body can
 * be written straight to disk: the share target hands the upload a file, and
 * never holds a second copy of the content in a memory budget that cannot afford
 * one.
 */
class MultipartForm(
	val boundary: String,
	val textParts: List<TextPart>,
	val filePart: FilePart,
) {
	data class TextPart(val name: String, val value: String)

	/**
	 * The `filename` attribute is what makes the server treat this part as a file
	 * rather than a text field.
	 */
	class FilePart(val name: String, val filename: String, val bytes: ByteArray)

	val contentType: String get() = "multipart/form-data; boundary=$boundary"

	fun body(): ByteArray = preamble() + filePart.bytes + epilogue()

	/**
	 * Writes around the content bytes rather than into a buffer that duplicates
	 * them — the whole reason the body is file-backed.
	 */
	fun writeTo(destination: File) {
		val sink = FileOutputStream(destination)
		try {
			sink.write(preamble())
			sink.write(filePart.bytes)
			sink.write(epilogue())
		} finally {
			sink.close()
		}
	}

	private fun preamble(): ByteArray {
		val head = StringBuilder()
		for (part in textParts) {
			head.append("--$boundary\r\n")
			head.append("Content-Disposition: form-data; name=\"${part.name}\"\r\n\r\n")
			head.append("${part.value}\r\n")
		}
		head.append("--$boundary\r\n")
		head.append(
			"Content-Disposition: form-data; name=\"${filePart.name}\"; " +
				"filename=\"${filePart.filename}\"\r\n\r\n",
		)
		return head.toString().toByteArray(Charsets.UTF_8)
	}

	private fun epilogue(): ByteArray = "\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8)
}
