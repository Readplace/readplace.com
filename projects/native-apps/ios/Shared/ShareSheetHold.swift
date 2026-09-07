import Foundation

@MainActor
final class ShareSheetHold {
	private let holdSeconds: TimeInterval
	private var endNow: (() -> Void)?

	init(holdSeconds: TimeInterval) {
		self.holdSeconds = holdSeconds
	}

	func end() {
		endNow?()
	}

	func untilSettledAndRead(_ settled: Task<Void, Never>) async {
		let claim = FirstClaim()
		let seconds = holdSeconds
		await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
			endNow = { if claim.take() { continuation.resume() } }
			Task { @MainActor in
				await settled.value
				try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
				if claim.take() { continuation.resume() }
			}
		}
	}
}
