import XCTest
import SwiftUI
@testable import Readplace

final class SharedArticlesDropTests: XCTestCase {
	private func readlist(label: String, href: String) -> Readlist {
		Readlist(entry: CollectionReadlist(label: label, rel: "readlist", href: href))
	}

	private func advertised() -> [Readlist] {
		[
			readlist(label: "All", href: "/queue"),
			readlist(label: "Work", href: "/queue?queue=work"),
			readlist(label: "Home", href: "/queue?queue=home"),
		]
	}

	func testTheMainlineReadlistIsAlwaysWhereSharedArticlesDrop() {
		let drop = SharedArticlesDrop(
			readlist: readlist(label: "All", href: "/queue"), mainlineHref: "/queue", tickedHrefs: []
		)

		XCTAssertEqual(drop, .always(label: "All"), "every save lands in the whole queue, ticked or not")
		XCTAssertNil(
			drop.choice,
			"so it carries no readlist for a caller to toggle, record, or send to the server"
		)
		XCTAssertTrue(drop.showsTick, "and it reads as ticked, because that is what actually happens")
	}

	func testAReaderOwnedReadlistReadsTickedOnlyWhileItIsTicked() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		let ticked = SharedArticlesDrop(readlist: work, mainlineHref: "/queue", tickedHrefs: ["/queue?queue=work"])
		let unticked = SharedArticlesDrop(readlist: work, mainlineHref: "/queue", tickedHrefs: [])

		XCTAssertEqual(ticked, .ticked(work), "the readlist the reader ticked claims shared articles")
		XCTAssertTrue(ticked.showsTick)
		XCTAssertEqual(unticked, .unticked(work), "and the one they did not, does not")
		XCTAssertFalse(unticked.showsTick)
		XCTAssertEqual(
			[ticked.choice, unticked.choice], [work, work],
			"either way it is the reader's to change, so both carry the readlist"
		)
	}

	func testAReaderWhoTickedTheMainlineOnAnOlderBuildStillSeesItLocked() {
		let drop = SharedArticlesDrop(
			readlist: readlist(label: "All", href: "/queue"), mainlineHref: "/queue", tickedHrefs: ["/queue"]
		)

		XCTAssertEqual(
			drop, .always(label: "All"),
			"a recorded mainline href is a leftover from a build that let it be ticked, not a choice to honour"
		)
		XCTAssertNil(drop.choice, "so it cannot be re-recorded from this screen either")
	}

	func testAReadlistIsOnlyTheMainlineWhenTheCollectionSaysSo() {
		let all = readlist(label: "All", href: "/queue")

		let drop = SharedArticlesDrop(readlist: all, mainlineHref: nil, tickedHrefs: [])

		XCTAssertEqual(
			drop, .unticked(all),
			"a collection that names no root leaves every readlist a readlist the reader may tick"
		)
	}

	func testTheLabelIsTheServersForEveryKindOfRow() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		XCTAssertEqual(SharedArticlesDrop.always(label: "All").label, "All")
		XCTAssertEqual(SharedArticlesDrop.ticked(work).label, "Work")
		XCTAssertEqual(SharedArticlesDrop.unticked(work).label, "Work")
	}

	func testTheFirstAskOffersEveryReadlistWithTheMainlineLocked() {
		let drops = SharedArticlesDrop.firstAsk(readlists: advertised(), mainlineHref: "/queue")

		XCTAssertEqual(
			drops.map(\.label), ["All", "Work", "Home"],
			"the reader is shown every readlist the server advertised, in wire order"
		)
		XCTAssertEqual(
			drops.map(\.showsTick), [true, false, false],
			"nothing is ticked before the reader answers, except the mainline that is never theirs to untick"
		)
		XCTAssertEqual(
			drops.compactMap(\.choice).map(\.label), ["Work", "Home"],
			"so only their own readlists can end up in the answer"
		)
	}

	func testTheFirstAskOfAReaderWithOnlyTheMainlineHasNothingToChoose() {
		let drops = SharedArticlesDrop.firstAsk(
			readlists: [readlist(label: "All", href: "/queue")], mainlineHref: "/queue"
		)

		XCTAssertEqual(drops, [.always(label: "All")])
		XCTAssertEqual(
			drops.compactMap(\.choice), [],
			"a question with no answerable row is a question the share sheet must not ask"
		)
	}

	func testTheLockedRowSaysTheSameThingATickedOneSays() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		XCTAssertEqual(
			SharedArticlesDropPresentation.title(for: .always(label: "All")),
			SharedArticlesDropPresentation.title(for: .ticked(work)),
			"the mainline states the rule the reader already gets, so it borrows the same words"
		)
		XCTAssertEqual(SharedArticlesDropPresentation.title(for: .ticked(work)), "Shared articles drop here")
		XCTAssertEqual(
			SharedArticlesDropPresentation.title(for: .unticked(work)), "Want shared article to drop here?"
		)
	}

	func testAnEmptyBoxReadsAsUntickedAndATickedOneAsFilled() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		XCTAssertEqual(SharedArticlesDropPresentation.boxSystemImage(for: .always(label: "All")), "checkmark.square.fill")
		XCTAssertEqual(SharedArticlesDropPresentation.boxSystemImage(for: .ticked(work)), "checkmark.square.fill")
		XCTAssertEqual(SharedArticlesDropPresentation.boxSystemImage(for: .unticked(work)), "square")
	}

	func testTheLockedRowIsTintedLikeAReaderChosenTickRatherThanDimmed() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		XCTAssertEqual(SharedArticlesDropPresentation.boxTint(for: .always(label: "All")), Color.brandSuccessText)
		XCTAssertEqual(SharedArticlesDropPresentation.boxTint(for: .ticked(work)), Color.brandSuccessText)
		XCTAssertEqual(SharedArticlesDropPresentation.boxTint(for: .unticked(work)), Color.brandTextSecondary)
		XCTAssertEqual(SharedArticlesDropPresentation.titleTint(for: .always(label: "All")), Color.brandTextPrimary)
		XCTAssertEqual(SharedArticlesDropPresentation.titleTint(for: .ticked(work)), Color.brandTextPrimary)
		XCTAssertEqual(SharedArticlesDropPresentation.titleTint(for: .unticked(work)), Color.brandTextSecondary)
		XCTAssertEqual(SharedArticlesDropPresentation.borderOpacity(for: .always(label: "All")), 1)
		XCTAssertEqual(SharedArticlesDropPresentation.borderOpacity(for: .ticked(work)), 1)
		XCTAssertEqual(SharedArticlesDropPresentation.borderOpacity(for: .unticked(work)), 0.35)
	}

	func testOnlyTheRowTheReaderCannotChangeCarriesALock() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		XCTAssertEqual(SharedArticlesDropPresentation.lockSystemImage(for: .always(label: "All")), "lock.fill")
		XCTAssertNil(
			SharedArticlesDropPresentation.lockSystemImage(for: .ticked(work)),
			"a tick the reader chose can be unticked, so nothing claims otherwise"
		)
		XCTAssertNil(SharedArticlesDropPresentation.lockSystemImage(for: .unticked(work)))
	}

	func testEveryRowIsAnnouncedAsTappableAndOnlyATickedOneAsSelected() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		XCTAssertEqual(
			SharedArticlesDropPresentation.accessibilityTraits(for: .always(label: "All")),
			[.isButton, .isSelected],
			"the locked row answers a tap with its explanation, so VoiceOver may offer to activate it"
		)
		XCTAssertEqual(
			SharedArticlesDropPresentation.accessibilityTraits(for: .ticked(work)), [.isButton, .isSelected]
		)
		XCTAssertEqual(SharedArticlesDropPresentation.accessibilityTraits(for: .unticked(work)), .isButton)
	}

	func testOnlyTheLockedRowExplainsItselfWhenTapped() {
		let work = readlist(label: "Work", href: "/queue?queue=work")

		XCTAssertEqual(
			SharedArticlesDropPresentation.explanation(for: .always(label: "All")),
			"Articles always drop on All. Reading one marks as read in all readlists.",
			"a tick the reader cannot change owes them the reason it is there"
		)
		XCTAssertNil(
			SharedArticlesDropPresentation.explanation(for: .ticked(work)),
			"a row the reader can simply untick explains itself by answering the tap"
		)
		XCTAssertNil(SharedArticlesDropPresentation.explanation(for: .unticked(work)))
	}

	func testTheExplanationCallsTheMainlineWhateverTheServerCallsIt() {
		let renamed = readlist(label: "Everything", href: "/queue")

		let drop = SharedArticlesDrop(readlist: renamed, mainlineHref: "/queue", tickedHrefs: [])

		XCTAssertEqual(
			SharedArticlesDropPresentation.explanation(for: drop),
			"Articles always drop on Everything. Reading one marks as read in all readlists.",
			"the popup names the readlist from the server's own label, so renaming it server-side renames it here"
		)
		XCTAssertEqual(
			SharedArticlesDropPresentation.explanation(for: drop)?.contains(drop.label), true,
			"there is one source for that name — the row and the popup can never disagree about it"
		)
	}

	func testTheRowThatExplainsItselfIsExactlyTheRowThatLocks() {
		let work = readlist(label: "Work", href: "/queue?queue=work")
		let rows: [SharedArticlesDrop] = [.always(label: "All"), .ticked(work), .unticked(work)]

		XCTAssertEqual(
			rows.map { SharedArticlesDropPresentation.explanation(for: $0) != nil },
			rows.map { SharedArticlesDropPresentation.lockSystemImage(for: $0) != nil },
			"the lock is the promise that a tap will explain rather than toggle; neither may appear without the other"
		)
	}
}
