package com.readplace.android.share

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Flattens a share Intent into the plain [SharedItems] the extractor triages. The
 * Intent's own extras form the first item — `EXTRA_SUBJECT` is the host's caption
 * for it, `EXTRA_TEXT` its plain-text attachment, `EXTRA_STREAM` its files — and
 * each clip item follows as an item of its own, because a host can deliver the PDF
 * file and the page URL as separate items. A `content:` stream is never a URL to
 * save — it is a document whose bytes are read later, lazily, and only under the
 * byte ceiling.
 */
class ShareIntentReader(private val resolver: ContentResolver) {
	fun read(intent: Intent): SharedItems {
		val items = mutableListOf<SharedItem>()

		val streams = streams(intent)
		items += SharedItem(
			contentText = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.takeIf { it.isNotBlank() },
			urls = streams.filterNot { isPdf(it, intent.type) }.map { it.toString() },
			texts = listOfNotNull(intent.getStringExtra(Intent.EXTRA_TEXT)),
			pdfs = streams.filter { isPdf(it, intent.type) }.map { ContentPdf(resolver, it) },
		)

		intent.clipData?.let { clip ->
			for (index in 0 until clip.itemCount) {
				val item = clip.getItemAt(index)
				val uri = item.uri
				items += SharedItem(
					contentText = null,
					urls = listOfNotNull(uri?.takeUnless { isPdf(it, intent.type) }?.toString()),
					texts = listOfNotNull(item.text?.toString()),
					pdfs = listOfNotNull(uri?.takeIf { isPdf(it, intent.type) }?.let { ContentPdf(resolver, it) }),
				)
			}
		}
		return SharedItems(items)
	}

	private fun streams(intent: Intent): List<Uri> =
		when (intent.action) {
			Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
			Intent.ACTION_SEND_MULTIPLE ->
				intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
			else -> emptyList()
		}

	private fun isPdf(uri: Uri, intentType: String?): Boolean {
		if (uri.scheme != ContentResolver.SCHEME_CONTENT && uri.scheme != ContentResolver.SCHEME_FILE) return false
		val type = resolver.getType(uri) ?: intentType
		return type == PDF_MEDIA_TYPE
	}

	private class ContentPdf(
		private val resolver: ContentResolver,
		private val uri: Uri,
	) : SharedPdf {
		override val suggestedName: String?
			get() = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
				if (cursor.moveToFirst()) cursor.getString(0) else null
			}

		/** The size is checked against the ceiling before any bytes are read, and
		 * again while streaming, so an oversize document is refused rather than loaded. */
		override suspend fun bytes(maxBytes: Long): ByteArray? = withContext(Dispatchers.IO) {
			val announced = resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
				if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
			}
			if (announced != null && announced > maxBytes) return@withContext null
			resolver.openInputStream(uri)?.use { input ->
				val buffer = java.io.ByteArrayOutputStream()
				val chunk = ByteArray(64 * 1024)
				var total = 0L
				while (true) {
					val read = input.read(chunk)
					if (read < 0) break
					total += read
					if (total > maxBytes) return@withContext null
					buffer.write(chunk, 0, read)
				}
				buffer.toByteArray()
			}
		}
	}

	private companion object {
		const val PDF_MEDIA_TYPE = "application/pdf"
	}
}
