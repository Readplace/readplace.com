package com.readplace.android.app

import com.readplace.android.core.AppConfig
import com.readplace.android.core.Href

object ReaderRequest {
	fun url(readHref: String, baseUrl: String): String? {
		val url = Href.resolve(readHref, baseUrl) ?: return null
		return Href.appending(url, AppConfig.PLATFORM_QUERY_NAME, AppConfig.PLATFORM_QUERY_VALUE)
	}
}
