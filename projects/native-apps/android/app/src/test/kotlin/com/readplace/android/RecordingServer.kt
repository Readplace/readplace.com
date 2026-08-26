package com.readplace.android

import com.readplace.android.core.AppConfig
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.rules.ExternalResource

/**
 * A JUnit rule serving canned responses and recording the requests (and their
 * bodies) the client sent, so the networking layer can be tested without a real
 * server. The client walks redirects itself, so a 3xx with a `Location` header
 * comes back to it as a plain response and the hop it then sends is recorded as
 * its own request — which is what lets a test assert on the headers of each hop.
 */
class RecordingServer : ExternalResource() {
	class Stub(
		val status: Int,
		val headers: Map<String, String> = mapOf("Content-Type" to AppConfig.SIREN_MEDIA_TYPE),
		val body: ByteArray = ByteArray(0),
		/** Sent with `Transfer-Encoding: chunked`, so the response announces no
		 * `Content-Length` — the way a body of unknown size arrives. */
		val chunked: Boolean = false,
	) {
		companion object {
			fun json(status: Int, body: String): Stub = Stub(status, body = body.toByteArray(Charsets.UTF_8))

			fun redirect(to: String, status: Int = 303): Stub = Stub(status, headers = mapOf("Location" to to))
		}
	}

	class Record(val request: RecordedRequest, val body: ByteArray) {
		val path: String get() = request.url.encodedPath
		val method: String? get() = request.method

		fun header(name: String): String? = request.headers[name]
	}

	private val server = MockWebServer()
	private val lock = Any()
	private var handler: ((Record) -> Stub)? = null
	private val captured = mutableListOf<Record>()

	val baseUrl: String get() = server.url("/").toString().removeSuffix("/")

	val host: String get() = server.url("/").host

	fun handle(answer: (Record) -> Stub) {
		synchronized(lock) { handler = answer }
	}

	val records: List<Record> get() = synchronized(lock) { captured.toList() }

	fun records(path: String): List<Record> = records.filter { it.path == path }

	override fun before() {
		server.dispatcher = Recording()
		server.start()
	}

	override fun after() {
		server.close()
	}

	private inner class Recording : Dispatcher() {
		override fun dispatch(request: RecordedRequest): MockResponse {
			val record = Record(request, request.body?.toByteArray() ?: ByteArray(0))
			val handler = synchronized(lock) {
				captured.add(record)
				this@RecordingServer.handler
			}
			checkNotNull(handler) { "RecordingServer.handle was never called" }
			return responseFor(handler(record))
		}
	}

	/** Headers are applied after the body so a stub's explicit `Content-Length`
	 * overrides the one the body sets — a test can then announce a length the
	 * body doesn't honour. */
	private fun responseFor(stub: Stub): MockResponse {
		val response = MockResponse.Builder().code(stub.status)
		if (stub.chunked) {
			response.chunkedBody(Buffer().write(stub.body), CHUNK_BYTES)
		} else {
			response.body(Buffer().write(stub.body))
		}
		for ((name, value) in stub.headers) response.setHeader(name, value)
		return response.build()
	}

	private companion object {
		const val CHUNK_BYTES = 16
	}
}
