import Foundation
@testable import Readplace

@MainActor
final class InFlightProbe {
	private(set) var current = 0
	private(set) var maximum = 0
	private var holding = true
	private var held: [CheckedContinuation<Void, Never>] = []

	func enter() async {
		current += 1
		maximum = max(maximum, current)
		guard holding else { return }
		await withCheckedContinuation { held.append($0) }
	}

	func leave() {
		current -= 1
	}

	func open() {
		holding = false
		let released = held
		held = []
		for continuation in released { continuation.resume() }
	}
}

@MainActor
final class FakeReaderPrefetcher: ReaderPrefetching {
	struct Prefetch {
		let request: URLRequest
		let cookies: [HTTPCookie]
	}

	private var results: [Bool]
	private let probe: InFlightProbe?
	var onPrefetch: () -> Void = {}
	var holdsUntilCancelled = false
	private(set) var prefetched: [Prefetch] = []
	private(set) var events: [String] = []

	init(results: [Bool] = [], probe: InFlightProbe? = nil) {
		self.results = results
		self.probe = probe
	}

	func prefetch(request: URLRequest, cookies: [HTTPCookie]) async -> Bool {
		prefetched.append(Prefetch(request: request, cookies: cookies))
		events.append("prefetch \(request.url?.path ?? "")")
		onPrefetch()
		if let probe {
			await probe.enter()
			probe.leave()
		}
		if holdsUntilCancelled { try? await Task.sleep(nanoseconds: 10_000_000_000) }
		return results.isEmpty ? true : results.removeFirst()
	}

	func waitUntilStored() async {
		events.append("wait until stored")
	}
}
