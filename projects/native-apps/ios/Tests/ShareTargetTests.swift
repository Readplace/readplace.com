import XCTest
@testable import Readplace

final class ShareTargetTests: XCTestCase {
	private func container() -> AppGroupContainer {
		AppGroupContainer(url: TestSupport.temporaryContainer())
	}

	func testNoReadlistTakesSharedArticlesUntilOneIsTicked() {
		let target = ShareTarget(container: container())

		XCTAssertEqual(target.hrefs, [], "every readlist starts unticked, so no readlist claims shared articles")
		XCTAssertFalse(target.isDecided, "and the share sheet has a question left to ask")
	}

	func testARecordedSetIsReadBackByAFreshInstance() {
		let container = container()
		ShareTarget(container: container).record(hrefs: ["/queue?queue=work", "/queue?queue=home"])

		XCTAssertEqual(
			ShareTarget(container: container).hrefs, ["/queue?queue=work", "/queue?queue=home"],
			"the share extension is a separate process, so it reads the app's choice from the shared suite"
		)
	}

	func testRecordingAgainReplacesTheWholeSet() {
		let container = container()
		let target = ShareTarget(container: container)
		target.record(hrefs: ["/queue?queue=work", "/queue?queue=home"])

		target.record(hrefs: ["/queue?queue=home"])

		XCTAssertEqual(
			ShareTarget(container: container).hrefs, ["/queue?queue=home"],
			"the prompt asks for the whole set at once, so its answer replaces whatever was ticked before"
		)
	}

	func testRecordingAnswersTheQuestionTheShareSheetWouldOtherwiseAsk() {
		let container = container()

		ShareTarget(container: container).record(hrefs: ["/queue?queue=work"])

		XCTAssertTrue(ShareTarget(container: container).isDecided)
	}

	func testRecordingNothingIsStillAnAnswer() {
		let container = container()

		ShareTarget(container: container).record(hrefs: [])

		XCTAssertEqual(
			ShareTarget(container: container).hrefs, [],
			"Done with nothing ticked leaves no readlist claiming shares"
		)
		XCTAssertTrue(
			ShareTarget(container: container).isDecided,
			"the reader answered by ticking nothing, so the share sheet must not ask again"
		)
	}

	func testAddingAReadlistKeepsTheOnesAlreadyTicked() {
		let container = container()
		let target = ShareTarget(container: container)
		target.add(href: "/queue?queue=work")

		target.add(href: "/queue?queue=home")

		XCTAssertEqual(
			ShareTarget(container: container).hrefs, ["/queue?queue=work", "/queue?queue=home"],
			"a shared article drops into every readlist the reader ticked"
		)
		XCTAssertTrue(ShareTarget(container: container).isDecided, "and ticking a box answers the share sheet's question")
	}

	func testRemovingAReadlistLeavesTheOthersTicked() {
		let container = container()
		let target = ShareTarget(container: container)
		target.add(href: "/queue?queue=work")
		target.add(href: "/queue?queue=home")

		target.remove(href: "/queue?queue=work")

		XCTAssertEqual(
			ShareTarget(container: container).hrefs, ["/queue?queue=home"],
			"unticking one box says nothing about the others"
		)
	}

	func testRemovingTheLastTickedReadlistKeepsTheAnswer() {
		let container = container()
		let target = ShareTarget(container: container)
		target.add(href: "/queue?queue=work")

		target.remove(href: "/queue?queue=work")

		XCTAssertEqual(ShareTarget(container: container).hrefs, [], "no readlist claims shared articles any more")
		XCTAssertTrue(
			ShareTarget(container: container).isDecided,
			"the reader answered by unticking, so the share sheet must not ask again"
		)
	}

	func testForgettingClearsEveryTickAndTheAnswer() {
		let container = container()
		let target = ShareTarget(container: container)
		target.record(hrefs: ["/queue?queue=work", "/queue?queue=home"])

		target.forget()

		XCTAssertEqual(
			ShareTarget(container: container).hrefs, [],
			"sign-out leaves no choice behind, so the next account is prompted again"
		)
		XCTAssertFalse(
			ShareTarget(container: container).isDecided,
			"and the question is open again for whoever signs in next"
		)
	}

	func testAReadlistChosenByAnEarlierBuildStillTakesSharedArticles() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("/queue?queue=work", forKey: "shareTarget.readlistHref")
		defaults.set(true, forKey: "shareTarget.decided")

		let target = ShareTarget(container: container()).adoptingLegacy {
			SharedArticlesDropChoice.recordedByAnEarlierBuild(in: defaults)
		}

		XCTAssertEqual(
			target.hrefs, ["/queue?queue=work"],
			"an upgrade must not silently stop dropping shares where the reader last said to"
		)
	}

	func testTheFirstTickAfterAnUpgradeJoinsTheEarlierBuildsChoice() {
		let container = container()
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("/queue?queue=work", forKey: "shareTarget.readlistHref")
		let target = ShareTarget(container: container).adoptingLegacy {
			SharedArticlesDropChoice.recordedByAnEarlierBuild(in: defaults)
		}

		target.add(href: "/queue?queue=home")

		XCTAssertEqual(
			ShareTarget(container: container).hrefs, ["/queue?queue=work", "/queue?queue=home"],
			"the readlist carried over is a tick like any other, so a second tick joins it"
		)
	}

	func testSignOutTakesAnEarlierBuildsChoiceWithIt() {
		let container = container()
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("/queue?queue=work", forKey: "shareTarget.readlistHref")
		defaults.set(true, forKey: "shareTarget.decided")
		let adopt = { SharedArticlesDropChoice.recordedByAnEarlierBuild(in: defaults) }
		_ = ShareTarget(container: container).adoptingLegacy(adopt)

		ShareTarget(container: container).forget()

		XCTAssertEqual(
			ShareTarget(container: container).adoptingLegacy(adopt).hrefs, [],
			"sign-out records an answered-and-empty choice, so the old medium can never be adopted a second time"
		)
	}

	func testASetRecordedByAnEarlierBuildIsAdoptedWhole() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set(["/queue?queue=work", "/queue?queue=home"], forKey: "shareTarget.readlistHrefs")

		let target = ShareTarget(container: container()).adoptingLegacy {
			SharedArticlesDropChoice.recordedByAnEarlierBuild(in: defaults)
		}

		XCTAssertEqual(
			target.hrefs, ["/queue?queue=work", "/queue?queue=home"],
			"a reader who ticked several readlists keeps all of them across the upgrade"
		)
	}

	func testAnEarlierBuildsEmptyAnswerIsAdoptedAsAnAnswer() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set(true, forKey: "shareTarget.decided")

		let target = ShareTarget(container: container()).adoptingLegacy {
			SharedArticlesDropChoice.recordedByAnEarlierBuild(in: defaults)
		}

		XCTAssertTrue(
			target.isDecided,
			"ticking nothing was an answer before the upgrade, so the sheet must not ask again after it"
		)
		XCTAssertEqual(target.hrefs, [])
	}

	func testAFreshInstallHasNothingToAdopt() {
		let target = ShareTarget(container: container()).adoptingLegacy {
			SharedArticlesDropChoice.recordedByAnEarlierBuild(in: TestSupport.ephemeralDefaults())
		}

		XCTAssertFalse(
			target.isDecided,
			"nobody has been asked yet on a device that never ran the older build"
		)
	}

	func testTheSharedStoreAdoptsWhatAnEarlierBuildLeftAndEmptiesTheOldMedium() throws {
		let group = "test.\(UUID().uuidString)"
		let defaults = try XCTUnwrap(UserDefaults(suiteName: group))
		defer { defaults.removePersistentDomain(forName: group) }
		defaults.set(["/queue?queue=work"], forKey: "shareTarget.readlistHrefs")

		let target = ShareTarget.inSharedContainer(container(), appGroupId: group)

		XCTAssertEqual(
			target.hrefs, ["/queue?queue=work"],
			"the composition root hands the store the App Group, and the upgrade is read once on the way in"
		)
		XCTAssertNil(
			SharedArticlesDropChoice.recordedByAnEarlierBuild(in: defaults),
			"and then emptied, so a later account on this device can never be handed this reader's old answer"
		)
	}

	func testTheOldMediumIsEmptiedEvenWhenTheStoreAlreadyHeldAnAnswer() throws {
		let group = "test.\(UUID().uuidString)"
		let defaults = try XCTUnwrap(UserDefaults(suiteName: group))
		defer { defaults.removePersistentDomain(forName: group) }
		defaults.set(["/queue?queue=work"], forKey: "shareTarget.readlistHrefs")
		let container = container()
		ShareTarget(container: container).record(hrefs: ["/queue?queue=home"])

		let target = ShareTarget.inSharedContainer(container, appGroupId: group)

		XCTAssertEqual(
			target.hrefs, ["/queue?queue=home"],
			"this build's answer is already on disk, so the old one is not adopted over it"
		)
		XCTAssertNil(
			SharedArticlesDropChoice.recordedByAnEarlierBuild(in: defaults),
			"but it is emptied all the same, whichever process reaches it first"
		)
	}

	func testAnAppGroupWithNoDefaultsSuiteAdoptsNothing() {
		let target = ShareTarget.inSharedContainer(container(), appGroupId: "NSGlobalDomain")

		XCTAssertFalse(
			target.isDecided,
			"a suite that cannot be opened is an absent history, not a reason to fail a save"
		)
	}
}
