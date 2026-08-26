package com.readplace.android.share

import com.readplace.android.core.UrlDetection

/**
 * A PDF the share delivered as a file. Its bytes are deliberately not read at
 * extraction: `SaveSharedPage` reads them only after its logged-out / no-link guards
 * pass, so a doomed share never pulls up to 25 MiB into memory. The read checks the
 * document's size against the byte ceiling before any bytes are read, so an oversize
 * document is refused rather than loaded.
 */
interface SharedPdf {
	/** The file name the host attached to the document, when it attached one. */
	val suggestedName: String?

	/** The document's bytes, or null when it is over [maxBytes] or cannot be read. */
	suspend fun bytes(maxBytes: Long): ByteArray?
}

/**
 * One item of a share, as the iOS extension saw one `NSExtensionItem`: the host's
 * own caption for it ([contentText]) and its attachments — URLs, plain texts and
 * PDF files — flattened out of the Intent by its adapter so a test can drive the
 * extraction with plain values.
 */
data class SharedItem(
	val contentText: String?,
	val urls: List<String>,
	val texts: List<String>,
	val pdfs: List<SharedPdf>,
)

/**
 * Every item is gathered before deciding: a host can deliver the PDF file and the
 * web URL as separate items, and the first item alone would look like a URL-less
 * share.
 */
data class SharedItems(val items: List<SharedItem>)

/**
 * Pulls the shared web URL (and any provided title) out of the share payload, plus
 * the PDF the payload carries as a file — a PDF viewer and the Files app share the
 * document itself, not just a link.
 */
object ShareExtractor {
	data class Shared(
		val url: String?,
		val title: String?,
		val pdf: SharedPdf?,
	)

	fun extract(items: SharedItems): Shared? {
		var url: String? = null
		var title: String? = null
		var pdf: SharedPdf? = null
		for (item in items.items) {
			if (url == null) url = webUrl(item)
			if (pdf == null) pdf = item.pdfs.firstOrNull()
			if (title == null) title = item.contentText
		}
		if (url == null && pdf == null) return null
		return Shared(url = url, title = title ?: pdf?.suggestedName, pdf = pdf)
	}

	/** An item's own URL attachments first, then a URL found inside its plain text —
	 * the same order per item, so a later item's URL never outranks an earlier
	 * item's text. */
	private fun webUrl(item: SharedItem): String? =
		item.urls.firstOrNull(UrlDetection::isWebUrl)
			?: item.texts.firstNotNullOfOrNull(UrlDetection::firstWebUrl)
}
