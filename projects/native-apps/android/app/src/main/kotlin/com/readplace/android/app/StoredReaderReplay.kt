package com.readplace.android.app

import com.readplace.android.core.ReaderPrefetch

data class ReaderResourceRequest(val url: String, val method: String, val isMainFrame: Boolean)

class ReplayedReaderPage(val mimeType: String, val encoding: String?, val headers: Map<String, String>, val body: ByteArray)

object StoredReaderReplay {
	fun of(request: ReaderResourceRequest, readerUrl: String, cacheMode: ReaderCacheMode, source: ReaderOfflineSource): ReplayedReaderPage? {
		if (cacheMode != ReaderCacheMode.STORED_COPY_FIRST || source !is ReaderOfflineSource.Kept) return null
		if (!request.isMainFrame || request.method != "GET" || request.url != readerUrl) return null
		val page = source.page
		val parameters = page.contentType.split(";").map { it.trim() }
		val charset = parameters.drop(1).firstOrNull { it.startsWith("charset=", ignoreCase = true) }?.substringAfter("=")
		val policy = page.contentSecurityPolicy?.let { mapOf(ReaderPrefetch.CONTENT_SECURITY_POLICY_HEADER to it) }.orEmpty()
		return ReplayedReaderPage(
			mimeType = parameters.first(),
			encoding = charset,
			headers = mapOf("Content-Type" to page.contentType) + policy,
			body = page.body,
		)
	}
}
