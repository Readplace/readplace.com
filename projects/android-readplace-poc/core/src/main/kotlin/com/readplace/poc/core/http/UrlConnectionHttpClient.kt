package com.readplace.poc.core.http

import java.net.HttpURLConnection
import java.net.URL

/**
 * A thin [HttpClient] over `java.net.HttpURLConnection`. Redirect following is
 * disabled so the Siren walker can re-issue redirected requests with the auth
 * headers preserved. This is platform-free (no Android imports), so it lives in
 * the shared core and is exercised against the real server rather than unit-tested.
 */
class UrlConnectionHttpClient(
	private val connectTimeoutMillis: Int = 15_000,
	private val readTimeoutMillis: Int = 30_000,
) : HttpClient {
	override fun execute(request: HttpRequest): HttpResponse {
		val connection = URL(request.url).openConnection() as HttpURLConnection
		connection.requestMethod = request.method
		connection.instanceFollowRedirects = false
		connection.connectTimeout = connectTimeoutMillis
		connection.readTimeout = readTimeoutMillis
		for ((name, value) in request.headers) connection.setRequestProperty(name, value)

		request.body?.let { payload ->
			connection.doOutput = true
			connection.outputStream.use { it.write(payload) }
		}

		try {
			val status = connection.responseCode
			val stream = if (status in 200..399) connection.inputStream else connection.errorStream
			val body = stream?.use { it.readBytes() } ?: ByteArray(0)
			val headers = buildMap {
				for ((key, values) in connection.headerFields) {
					if (key != null && values.isNotEmpty()) put(key, values.last())
				}
			}
			return HttpResponse(status, headers, body)
		} finally {
			connection.disconnect()
		}
	}
}
