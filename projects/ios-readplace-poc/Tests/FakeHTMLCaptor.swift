import Foundation
@testable import Readplace

/// A test double for `HTMLCapturing` that returns a canned `CapturedPage` and
/// records the URLs it was asked to capture — no real WKWebView involved.
@MainActor
final class FakeHTMLCaptor: HTMLCapturing {
	private let page: CapturedPage
	private(set) var capturedURLs: [URL] = []

	init(page: CapturedPage) {
		self.page = page
	}

	func capture(url: URL) async -> CapturedPage {
		capturedURLs.append(url)
		return page
	}
}
