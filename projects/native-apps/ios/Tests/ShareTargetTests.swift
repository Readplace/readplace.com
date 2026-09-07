import XCTest
@testable import Readplace

final class ShareTargetTests: XCTestCase {
	func testNoTargetUntilOneIsRecorded() {
		let target = ShareTarget(defaults: TestSupport.ephemeralDefaults())

		XCTAssertNil(target.href, "every readlist starts unticked, so no readlist claims shared articles")
		XCTAssertFalse(target.isDecided, "and the share sheet has a question left to ask")
	}

	func testARecordedTargetIsReadBackByAFreshInstance() {
		let defaults = TestSupport.ephemeralDefaults()
		ShareTarget(defaults: defaults).record(href: "/queue?queue=work")

		XCTAssertEqual(
			ShareTarget(defaults: defaults).href, "/queue?queue=work",
			"the share extension is a separate process, so it reads the app's choice from the shared suite"
		)
	}

	func testRecordingAgainReplacesTheTarget() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.record(href: "/queue?queue=work")

		target.record(href: "/queue")

		XCTAssertEqual(
			ShareTarget(defaults: defaults).href, "/queue",
			"picking All is itself a choice, so it replaces the previous target rather than clearing it"
		)
	}

	func testRecordingAnswersTheQuestionTheShareSheetWouldOtherwiseAsk() {
		let defaults = TestSupport.ephemeralDefaults()

		ShareTarget(defaults: defaults).record(href: "/queue?queue=work")

		XCTAssertTrue(ShareTarget(defaults: defaults).isDecided)
	}

	func testClearingKeepsTheAnswerWhileDroppingTheTarget() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.record(href: "/queue?queue=work")

		target.clear()

		XCTAssertNil(ShareTarget(defaults: defaults).href, "unticking every box leaves no readlist claiming shares")
		XCTAssertTrue(
			ShareTarget(defaults: defaults).isDecided,
			"the reader answered by unticking, so the share sheet must not ask again"
		)
	}

	func testForgettingClearsTheTarget() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.record(href: "/queue?queue=work")

		target.forget()

		XCTAssertNil(
			ShareTarget(defaults: defaults).href,
			"sign-out leaves no choice behind, so the next account is prompted again"
		)
		XCTAssertFalse(
			ShareTarget(defaults: defaults).isDecided,
			"and the question is open again for whoever signs in next"
		)
	}
}
