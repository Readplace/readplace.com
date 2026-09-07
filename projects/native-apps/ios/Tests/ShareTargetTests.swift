import XCTest
@testable import Readplace

final class ShareTargetTests: XCTestCase {
	func testNoReadlistTakesSharedArticlesUntilOneIsTicked() {
		let target = ShareTarget(defaults: TestSupport.ephemeralDefaults())

		XCTAssertEqual(target.hrefs, [], "every readlist starts unticked, so no readlist claims shared articles")
		XCTAssertFalse(target.isDecided, "and the share sheet has a question left to ask")
	}

	func testARecordedSetIsReadBackByAFreshInstance() {
		let defaults = TestSupport.ephemeralDefaults()
		ShareTarget(defaults: defaults).record(hrefs: ["/queue?queue=work", "/queue?queue=home"])

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, ["/queue?queue=work", "/queue?queue=home"],
			"the share extension is a separate process, so it reads the app's choice from the shared suite"
		)
	}

	func testRecordingAgainReplacesTheWholeSet() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.record(hrefs: ["/queue?queue=work", "/queue?queue=home"])

		target.record(hrefs: ["/queue?queue=home"])

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, ["/queue?queue=home"],
			"the prompt asks for the whole set at once, so its answer replaces whatever was ticked before"
		)
	}

	func testRecordingAnswersTheQuestionTheShareSheetWouldOtherwiseAsk() {
		let defaults = TestSupport.ephemeralDefaults()

		ShareTarget(defaults: defaults).record(hrefs: ["/queue?queue=work"])

		XCTAssertTrue(ShareTarget(defaults: defaults).isDecided)
	}

	func testRecordingNothingIsStillAnAnswer() {
		let defaults = TestSupport.ephemeralDefaults()

		ShareTarget(defaults: defaults).record(hrefs: [])

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, [],
			"Done with nothing ticked leaves no readlist claiming shares"
		)
		XCTAssertTrue(
			ShareTarget(defaults: defaults).isDecided,
			"the reader answered by ticking nothing, so the share sheet must not ask again"
		)
	}

	func testAddingAReadlistKeepsTheOnesAlreadyTicked() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.add(href: "/queue?queue=work")

		target.add(href: "/queue?queue=home")

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, ["/queue?queue=work", "/queue?queue=home"],
			"a shared article drops into every readlist the reader ticked"
		)
		XCTAssertTrue(ShareTarget(defaults: defaults).isDecided, "and ticking a box answers the share sheet's question")
	}

	func testRemovingAReadlistLeavesTheOthersTicked() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.add(href: "/queue?queue=work")
		target.add(href: "/queue?queue=home")

		target.remove(href: "/queue?queue=work")

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, ["/queue?queue=home"],
			"unticking one box says nothing about the others"
		)
	}

	func testRemovingTheLastTickedReadlistKeepsTheAnswer() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.add(href: "/queue?queue=work")

		target.remove(href: "/queue?queue=work")

		XCTAssertEqual(ShareTarget(defaults: defaults).hrefs, [], "no readlist claims shared articles any more")
		XCTAssertTrue(
			ShareTarget(defaults: defaults).isDecided,
			"the reader answered by unticking, so the share sheet must not ask again"
		)
	}

	func testForgettingClearsEveryTickAndTheAnswer() {
		let defaults = TestSupport.ephemeralDefaults()
		let target = ShareTarget(defaults: defaults)
		target.record(hrefs: ["/queue?queue=work", "/queue?queue=home"])

		target.forget()

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, [],
			"sign-out leaves no choice behind, so the next account is prompted again"
		)
		XCTAssertFalse(
			ShareTarget(defaults: defaults).isDecided,
			"and the question is open again for whoever signs in next"
		)
	}

	func testAReadlistChosenByAnEarlierBuildStillTakesSharedArticles() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("/queue?queue=work", forKey: "shareTarget.readlistHref")
		defaults.set(true, forKey: "shareTarget.decided")

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, ["/queue?queue=work"],
			"an upgrade must not silently stop dropping shares where the reader last said to"
		)
	}

	func testTheFirstTickAfterAnUpgradeReplacesTheEarlierBuildsChoice() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("/queue?queue=work", forKey: "shareTarget.readlistHref")
		let target = ShareTarget(defaults: defaults)

		target.add(href: "/queue?queue=home")

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, ["/queue?queue=work", "/queue?queue=home"],
			"the readlist carried over is a tick like any other, so a second tick joins it"
		)
	}

	func testSignOutTakesAnEarlierBuildsChoiceWithIt() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("/queue?queue=work", forKey: "shareTarget.readlistHref")
		defaults.set(true, forKey: "shareTarget.decided")

		ShareTarget(defaults: defaults).forget()

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, [],
			"a choice made before the upgrade must not outlive the session that made it either"
		)
	}
}
