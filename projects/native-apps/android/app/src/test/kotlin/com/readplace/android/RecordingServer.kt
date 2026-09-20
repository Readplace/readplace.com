package com.readplace.android

import com.readplace.android.core.AppConfig
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.rules.ExternalResource
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

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

	/**
	 * A request/release barrier a handler can park a response on, so a test can
	 * drive a second, overlapping operation to completion while an earlier one is
	 * still on the wire — the way iOS's `.held(until:)` does. The held request
	 * blocks the server's dispatcher thread (never the test scheduler), so a race
	 * test must build the API with a real IO dispatcher rather than the test one.
	 */
	class Gate {
		private val arrived = CountDownLatch(1)
		private val released = CountDownLatch(1)

		/** Blocks the caller until the held request has reached the server. */
		fun awaitArrival() {
			check(arrived.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) { "the held request never reached the server" }
		}

		/** Releases the held response so its request completes. */
		fun release() {
			released.countDown()
		}

		/**
		 * Records this request's arrival and parks its response until [release],
		 * then answers with [stub] — captured before the park, so the held response
		 * carries the state the server was in when the request arrived, not when it
		 * was released. Called from inside a handler on the server's own thread.
		 */
		fun holding(stub: Stub): Stub {
			arrived.countDown()
			check(released.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) { "the held response was never released" }
			return stub
		}

		private companion object {
			const val TIMEOUT_SECONDS = 5L
		}
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
