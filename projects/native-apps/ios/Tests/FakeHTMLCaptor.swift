import Foundation
@testable import Readplace

/// A test double for `HTMLCapturing` that returns a canned `CapturedPage` and
/// records the URLs it was asked to capture — no real WKWebView involved. `delay`
/// models a render that runs long, which is what the save's grace window races.
@MainActor
final class FakeHTMLCaptor: HTMLCapturing {
	private let page: CapturedPage
	private let delay: TimeInterval
	private(set) var capturedURLs: [URL] = []

	init(page: CapturedPage, delay: TimeInterval = 0) {
		self.page = page
		self.delay = delay
	}

	func capture(url: URL) async -> CapturedPage {
		capturedURLs.append(url)
		if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
		return page
	}
}

/// Records what the save journey handed to the background session instead of
/// starting a real upload.
final class FakeBackgroundUploads: BackgroundUploading {
	struct Handoff {
		let request: URLRequest
		let file: URL
	}

	private(set) var handoffs: [Handoff] = []

	func upload(_ request: URLRequest, fromFile file: URL) {
		handoffs.append(Handoff(request: request, file: file))
	}
}

/// Records the app-side background-session work the app delegate drives.
final class FakeBackgroundSessionEvents: BackgroundSessionEvents {
	private(set) var resumedIdentifiers: [String] = []
	private(set) var drains: [() -> Void] = []

	func resume(sessionIdentifier: String, whenDrained: @escaping () -> Void) {
		resumedIdentifiers.append(sessionIdentifier)
		drains.append(whenDrained)
	}
}
