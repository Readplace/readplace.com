package com.readplace.android.app

import java.net.URI

object UploadFileChooser {
	fun accepts(pageUrl: String?, serverBaseUrl: String, isChoosing: Boolean): Boolean {
		if (isChoosing || pageUrl == null) return false
		val page = runCatching { URI(pageUrl) }.getOrNull() ?: return false
		val server = runCatching { URI(serverBaseUrl) }.getOrNull() ?: return false
		val path = page.path ?: return false
		return page.scheme.equals(server.scheme, ignoreCase = true) &&
			page.host.equals(server.host, ignoreCase = true) &&
			page.port == server.port &&
			(path == UPLOAD_PATH || path.startsWith("$UPLOAD_PATH/"))
	}

	fun mimeTypes(acceptTypes: Array<String>?): Array<String> {
		val types = acceptTypes.orEmpty().flatMap { it.split(',') }.map { it.trim() }.filter { it.contains('/') }
		return if (types.isEmpty()) arrayOf(ANY_TYPE) else types.toTypedArray()
	}

	private const val UPLOAD_PATH = "/upload"
	private const val ANY_TYPE = "*/*"
}
