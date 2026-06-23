import XCTest
@testable import Readplace

/// Tests the reader's pure helpers — URL resolution and the mark-read message
/// parser. The WKWebView/cookie/script glue around them is an OS boundary and is
/// exercised by hand, like `SafariView`/`AuthFlowView` before it.
final class ReaderBridgeTests: XCTestCase {
	func testReaderURLResolvesRootRelativeHref() {
		let url = readerURL(baseURL: "https://readplace.com", readHref: "/queue/a1/view")
		XCTAssertEqual(url?.absoluteString, "https://readplace.com/queue/a1/view")
	}

	func testReaderURLPassesThroughAbsoluteHref() {
		let url = readerURL(baseURL: "https://readplace.com", readHref: "https://example.com/queue/a1/view")
		XCTAssertEqual(url?.absoluteString, "https://example.com/queue/a1/view")
	}

	func testReaderURLResolvesRelativeHrefWithoutLeadingSlash() {
		let url = readerURL(baseURL: "https://readplace.com", readHref: "queue/a1/view")
		XCTAssertEqual(url?.absoluteString, "https://readplace.com/queue/a1/view")
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
}
