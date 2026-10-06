import Foundation
@testable import Readplace

@MainActor
final class FakeReaderPrefetcher: ReaderPrefetching {
	struct Prefetch {
		let request: URLRequest
		let cookies: [HTTPCookie]
	}

	private var results: [Bool]
	var onPrefetch: () -> Void = {}
	var holdsUntilCancelled = false
	private(set) var prefetched: [Prefetch] = []
	private(set) var events: [String] = []

	init(results: [Bool] = []) {
		self.results = results
	}

	func prefetch(request: URLRequest, cookies: [HTTPCookie]) async -> Bool {
		prefetched.append(Prefetch(request: request, cookies: cookies))
		events.append("prefetch \(request.url?.path ?? "")")
		onPrefetch()
		if holdsUntilCancelled { try? await Task.sleep(nanoseconds: 10_000_000_000) }
		return results.isEmpty ? true : results.removeFirst()
	}

	func waitUntilStored() async {
		events.append("wait until stored")
	}
}
