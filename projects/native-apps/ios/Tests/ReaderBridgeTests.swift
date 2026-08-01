import XCTest
@testable import Readplace

/// Tests the reader's pure helpers — href resolution and the mark-read message
/// parser. The WKWebView/cookie/script glue around them is an OS boundary and is
/// exercised by hand, like `AuthWebView`/`AuthFlowView` before it.
final class ReaderBridgeTests: XCTestCase {
	func testHrefResolvesRootRelative() {
		let url = Href.resolve("/queue/a1/view", baseURL: "https://readplace.com")
		XCTAssertEqual(url?.absoluteString, "https://readplace.com/queue/a1/view")
	}

	func testHrefPassesThroughAbsoluteHTTPS() {
		let url = Href.resolve("https://example.com/queue/a1/view", baseURL: "https://readplace.com")
		XCTAssertEqual(url?.absoluteString, "https://example.com/queue/a1/view")
	}

	func testHrefResolvesRelativeWithoutLeadingSlash() {
		let url = Href.resolve("queue/a1/view", baseURL: "https://readplace.com")
		XCTAssertEqual(url?.absoluteString, "https://readplace.com/queue/a1/view")
	}

	func testHrefPassesThroughAppDeepLinkScheme() {
		let url = Href.resolve("readplace://oauth-callback", baseURL: "https://readplace.com")
		XCTAssertEqual(url?.scheme, "readplace", "the client's own deep-link scheme is actionable, not foreign")
	}

	func testHrefTreatsForeignSchemeAsAbsent() {
		XCTAssertNil(Href.resolve("mailto:hi@example.com", baseURL: "https://readplace.com"))
		XCTAssertNil(Href.resolve("ftp://example.com/x", baseURL: "https://readplace.com"))
		XCTAssertNil(Href.resolve("javascript:alert(1)", baseURL: "https://readplace.com"))
	}

	func testIsMarkedReadAcceptsMarkedReadPayloadOnBridgeChannel() {
		XCTAssertTrue(ReaderBridge.isMarkedRead(message: ReaderBridge.messageName, body: ["type": "markedRead"]))
	}

	func testIsMarkedReadRejectsOtherMessageTypes() {
		XCTAssertFalse(ReaderBridge.isMarkedRead(message: ReaderBridge.messageName, body: ["type": "scrolled"]))
	}

	func testIsMarkedReadRejectsWrongChannel() {
		XCTAssertFalse(ReaderBridge.isMarkedRead(message: "someOtherHandler", body: ["type": "markedRead"]))
	}

	func testIsMarkedReadRejectsNonDictionaryBody() {
		XCTAssertFalse(ReaderBridge.isMarkedRead(message: ReaderBridge.messageName, body: "markedRead"))
	}

	func testIsCaptureBlockedAcceptsCaptureBlockedPayloadOnBridgeChannel() {
		XCTAssertTrue(ReaderBridge.isCaptureBlocked(message: ReaderBridge.messageName, body: ["type": "captureBlocked"]))
	}

	func testIsCaptureBlockedRejectsOtherMessageTypes() {
		XCTAssertFalse(ReaderBridge.isCaptureBlocked(message: ReaderBridge.messageName, body: ["type": "scrolled"]))
	}

	func testIsCaptureBlockedRejectsWrongChannel() {
		XCTAssertFalse(ReaderBridge.isCaptureBlocked(message: "someOtherHandler", body: ["type": "captureBlocked"]))
	}

	func testIsCaptureBlockedRejectsNonDictionaryBody() {
		XCTAssertFalse(ReaderBridge.isCaptureBlocked(message: ReaderBridge.messageName, body: "captureBlocked"))
	}

	func testTheTwoBridgeMessagesDoNotCrossFireOnTheirSharedChannel() {
		XCTAssertFalse(
			ReaderBridge.isMarkedRead(message: ReaderBridge.messageName, body: ["type": "captureBlocked"]),
			"a capture request must not mark the article read"
		)
		XCTAssertFalse(
			ReaderBridge.isCaptureBlocked(message: ReaderBridge.messageName, body: ["type": "markedRead"]),
			"a mark-read must not start a capture"
		)
	}
}
