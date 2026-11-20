package com.readplace.android.core

import okhttp3.Cookie
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

fun interface ReaderPrefetching {
	suspend fun prefetch(url: String, cookies: List<Cookie>): Boolean
}

object ReaderPrefetch {
	const val PURPOSE_HEADER = "Sec-Purpose"
	const val PURPOSE_VALUE = "prefetch"
	const val DOCUMENT_ACCEPT = "text/html"
	const val ARTICLE_VERSION_HEADER = "Readplace-Article-Version"
	const val CONTENT_SECURITY_POLICY_HEADER = "Content-Security-Policy"
	val PAGE_TIMEOUT = 12.seconds
	val IMAGE_TIMEOUT = 12.seconds
	val IMAGE_POLL = 250.milliseconds

	const val EAGER_IMAGES_SCRIPT = """document.querySelectorAll('img[loading="lazy"]').forEach(function (image) { image.loading = "eager"; });"""

	const val IMAGES_SETTLED_SCRIPT = """Array.prototype.every.call(document.images, function (image) { return image.complete; })"""

	fun wasStored(documentFinished: Boolean, mainFrameFailed: Boolean, mainFrameHttpError: Int?): Boolean =
		documentFinished && !mainFrameFailed && mainFrameHttpError == null

	fun imagesSettled(answer: String?): Boolean = answer == "true"
}
