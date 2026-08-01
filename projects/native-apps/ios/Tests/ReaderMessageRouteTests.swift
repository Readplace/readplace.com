import XCTest
@testable import Readplace

final class ReaderMessageRouteTests: XCTestCase {
	private func route(
		_ body: Any,
		captureInFlight: Bool = false,
		alreadyMarkedRead: Bool = false
	) -> ReaderMessageRoute {
		ReaderMessageRoute.route(
			message: ReaderBridge.messageName,
			body: body,
			captureInFlight: captureInFlight,
			alreadyMarkedRead: alreadyMarkedRead
		)
	}

	func testACaptureRequestStartsACapture() {
		XCTAssertEqual(route(["type": "captureBlocked"]), .startCapture)
	}

	func testASecondCaptureRequestIsIgnoredWhileTheFirstIsStillRunning() {
		XCTAssertEqual(
			route(["type": "captureBlocked"], captureInFlight: true), .ignore,
			"the blocked notice can be tapped again while the hidden render is still in flight; a second render would upload the same page twice"
		)
	}

	func testACaptureRequestStartsACaptureEvenOnceTheArticleWasMarkedRead() {
		XCTAssertEqual(
			route(["type": "captureBlocked"], alreadyMarkedRead: true), .startCapture,
			"the mark-read latch belongs to mark-read only — it must not swallow a capture"
		)
	}

	func testAMarkReadReportMarksTheArticleRead() {
		XCTAssertEqual(route(["type": "markedRead"]), .markRead)
	}

	func testASecondMarkReadReportIsIgnored() {
		XCTAssertEqual(
			route(["type": "markedRead"], alreadyMarkedRead: true), .ignore,
			"the sheet closes and the row leaves the list once; a repeat report must not re-fire it"
		)
	}

	func testAMarkReadReportIsStillHonouredWhileACaptureIsRunning() {
		XCTAssertEqual(
			route(["type": "markedRead"], captureInFlight: true), .markRead,
			"the capture latch belongs to capture only"
		)
	}

	func testAMessageTheBridgeDoesNotRecogniseIsIgnored() {
		XCTAssertEqual(route(["type": "scrolled"]), .ignore)
		XCTAssertEqual(
			ReaderMessageRoute.route(
				message: "someOtherHandler",
				body: ["type": "captureBlocked"],
				captureInFlight: false,
				alreadyMarkedRead: false
			),
			.ignore,
			"a message on another channel drives neither side effect"
		)
	}
}
