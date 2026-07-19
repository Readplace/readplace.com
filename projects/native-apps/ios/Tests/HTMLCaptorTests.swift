import XCTest
@testable import Readplace

final class HTMLCaptorTests: XCTestCase {
	func testMainFramePdfIsCapturedAsFile() {
		XCTAssertEqual(
			HTMLCaptor.navigationResponseDecision(mimeType: "application/pdf", isMainFrame: true),
			.captureAsFile(mediaType: "application/pdf")
		)
	}

	func testMainFrameHtmlIsAllowedAndStampsItsMediaType() {
		XCTAssertEqual(
			HTMLCaptor.navigationResponseDecision(mimeType: "text/html", isMainFrame: true),
			.allow(detectedMediaType: "text/html")
		)
	}

	func testSubframePdfIsAllowedAndStampsNothing() {
		// Only a main-frame PDF is captured as a file; a PDF loaded into a subframe
		// must not cancel the whole page or overwrite the page's own media type.
		XCTAssertEqual(
			HTMLCaptor.navigationResponseDecision(mimeType: "application/pdf", isMainFrame: false),
			.allow(detectedMediaType: nil)
		)
	}

	func testMainFrameWithoutAMediaTypeIsAllowed() {
		XCTAssertEqual(
			HTMLCaptor.navigationResponseDecision(mimeType: nil, isMainFrame: true),
			.allow(detectedMediaType: nil)
		)
	}
}
