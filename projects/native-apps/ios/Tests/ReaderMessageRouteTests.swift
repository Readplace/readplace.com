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

	func testAStatusChangeReportReconcilesTheList() {
		XCTAssertEqual(route(["type": "statusChanged"]), .reconcileStatus)
	}

	func testAStatusChangeReportIsHonouredAfterTheArticleWasMarkedRead() {
		XCTAssertEqual(
			route(["type": "statusChanged"], alreadyMarkedRead: true), .reconcileStatus,
			"the mark-read latch closes the sheet once; a status change keeps it open, so it must not be latched with it"
		)
	}

	func testAStatusChangeReportIsHonouredWhileACaptureIsRunning() {
		XCTAssertEqual(
			route(["type": "statusChanged"], captureInFlight: true), .reconcileStatus,
			"the capture latch belongs to capture only"
		)
	}

	func testAStatusChangeReportOnAnotherChannelIsIgnored() {
		XCTAssertEqual(
			ReaderMessageRoute.route(
				message: "someOtherHandler",
				body: ["type": "statusChanged"],
				captureInFlight: false,
				alreadyMarkedRead: false
			),
			.ignore,
			"a page that registers its own interface must not be able to drive the list"
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
