import Foundation

/// A `URLProtocol` that serves canned responses and records the requests (and
/// their bodies) the client sent, so the networking layer can be tested without
/// a real server. Handles redirects: returning a 3xx with a `Location` header
/// makes `URLSession` follow it through the task delegate.
final class StubURLProtocol: URLProtocol {
	struct Stub {
		let status: Int
		let headers: [String: String]
		let body: Data

		init(status: Int, headers: [String: String] = ["Content-Type": "application/vnd.siren+json"], body: Data = Data()) {
			self.status = status
			self.headers = headers
			self.body = body
		}

		static func json(_ status: Int, _ string: String) -> Stub {
			Stub(status: status, body: Data(string.utf8))
		}

		static func redirect(to location: String, status: Int = 303) -> Stub {
			Stub(status: status, headers: ["Location": location])
		}
	}

	struct Record {
		let request: URLRequest
		let body: Data
	}

	private static let lock = NSLock()
	private static var handler: ((URLRequest, Data) throws -> Stub)?
	private static var captured: [Record] = []

	static func setHandler(_ handler: @escaping (URLRequest, Data) throws -> Stub) {
		lock.lock(); defer { lock.unlock() }
		self.handler = handler
	}

	static func reset() {
		lock.lock(); defer { lock.unlock() }
		handler = nil
		captured = []
	}

	static var records: [Record] {
		lock.lock(); defer { lock.unlock() }
		return captured
	}

	static func records(path: String) -> [Record] {
		records.filter { $0.request.url?.path == path }
	}

	// MARK: URLProtocol

	override class func canInit(with request: URLRequest) -> Bool { true }
	override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

	override func startLoading() {
		let body = StubURLProtocol.readBody(request)
		StubURLProtocol.lock.lock()
		StubURLProtocol.captured.append(Record(request: request, body: body))
		let handler = StubURLProtocol.handler
		StubURLProtocol.lock.unlock()

		guard let handler, let url = request.url else {
			client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
			return
		}
		do {
			let stub = try handler(request, body)
			let response = HTTPURLResponse(
				url: url,
				statusCode: stub.status,
				httpVersion: "HTTP/1.1",
				headerFields: stub.headers
			)!
			client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
			if !stub.body.isEmpty { client?.urlProtocol(self, didLoad: stub.body) }
			client?.urlProtocolDidFinishLoading(self)
		} catch {
			client?.urlProtocol(self, didFailWithError: error)
		}
	}

	override func stopLoading() {}

	/// `URLSession` moves `httpBody` into `httpBodyStream` by the time a protocol
	/// sees the request, so read the stream to capture POST bodies.
	private static func readBody(_ request: URLRequest) -> Data {
		if let body = request.httpBody { return body }
		guard let stream = request.httpBodyStream else { return Data() }
		stream.open()
		defer { stream.close() }
		var data = Data()
		let bufferSize = 4096
		var buffer = [UInt8](repeating: 0, count: bufferSize)
		while stream.hasBytesAvailable {
			let read = stream.read(&buffer, maxLength: bufferSize)
			if read <= 0 { break }
			data.append(buffer, count: read)
		}
		return data
	}
}
