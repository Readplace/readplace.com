import Foundation
import XCTest

@MainActor
final class FakeRefreshPause {
	enum Mode {
		case immediate
		case held
	}

	var mode: Mode
	private(set) var durations: [TimeInterval] = []
	private var waiting: [CheckedContinuation<Void, Never>] = []

	init(_ mode: Mode) {
		self.mode = mode
	}

	func pause(_ duration: TimeInterval) async throws {
		durations.append(duration)
		try Task.checkCancellation()
		if mode == .held {
			await withCheckedContinuation { waiting.append($0) }
		}
		try Task.checkCancellation()
	}

	func release() {
		let released = waiting
		waiting = []
		for continuation in released { continuation.resume() }
	}

	func waitForPauses(_ count: Int, file: StaticString = #filePath, line: UInt = #line) async {
		let deadline = Date().addingTimeInterval(5)
		while durations.count < count, Date() < deadline {
			try? await Task.sleep(nanoseconds: 1_000_000)
		}
		XCTAssertGreaterThanOrEqual(durations.count, count, "the refresh loop never reached this pause", file: file, line: line)
	}
}
