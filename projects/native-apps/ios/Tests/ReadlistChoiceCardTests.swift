import SwiftUI
import UIKit
import XCTest

@testable import Readplace

@MainActor
final class ReadlistChoiceCardTests: XCTestCase {
	private static let serverLabelMaximum = 24
	private static let serverDefinitionMaximum = 7
	private static let narrowest = CGSize(width: 320, height: 568)
	private static let landscape = CGSize(width: 667, height: 375)
	private static let portrait = CGSize(width: 390, height: 700)
	private static let touchTargetFloor = 44.0

	private static let checkpoints: [(name: String, style: UIUserInterfaceStyle)] = [
		("first-run", .light),
		("first-run", .dark),
		("one-readlist", .light),
		("ticked", .light),
	]

	// MARK: - Geometry

	func testEveryRowStacksBelowTheOneBeforeItInsideTheCard() {
		let card = mount(fullList(), size: Self.portrait)

		for (index, row) in card.rows.enumerated().dropFirst() {
			let previous = card.rows[index - 1]
			XCTAssertGreaterThanOrEqual(
				row.frame.minY, previous.frame.maxY,
				"row \(index) overlaps the row above it, so a tap lands on the wrong readlist"
			)
			XCTAssertTrue(
				card.card.bounds.contains(card.list.convert(row.frame, to: card.card)),
				"row \(index) escapes the card, so part of a choice is unreachable"
			)
		}
	}

	func testEveryRowFillsTheCardWidth() {
		let card = mount(fullList(), size: Self.portrait)

		for (index, row) in card.rows.enumerated() {
			XCTAssertEqual(
				row.frame.width, card.list.bounds.width, accuracy: 0.5,
				"row \(index) is sized to its own label, so the column reads as ragged rather than as one list"
			)
		}
		XCTAssertEqual(
			card.list.bounds.width, card.card.bounds.width - 48, accuracy: 0.5,
			"the list must span the card's 24pt padding on both sides"
		)
	}

	func testDoneStandsFurtherFromTheListThanTheRowsStandFromEachOther() {
		let card = mount(fullList(), size: Self.portrait)

		let listInCard = card.scroll.convert(card.scroll.bounds, to: card.card)
		let doneInCard = card.done.convert(card.done.bounds, to: card.card)

		XCTAssertGreaterThan(
			doneInCard.minY - listInCard.maxY, card.list.spacing,
			"a gap equal to the row spacing makes the primary action read as one more readlist"
		)
	}

	func testDoneIsTheOnlyFilledControlAndCarriesNoTickBox() {
		let card = mount(fullList(), size: Self.portrait)

		XCTAssertEqual(
			card.done.configuration?.baseBackgroundColor, BrandColor.amber,
			"the primary action is the one amber block on the card"
		)
		XCTAssertNil(
			card.done.configuration?.image,
			"a tick box on Done would read as a readlist that can be chosen"
		)
		for (index, row) in card.rows.enumerated() {
			let button = row as? UIButton
			XCTAssertNil(
				button?.configuration,
				"row \(index) carries a filled button configuration, so a ticked row competes with Done for the eye"
			)
		}
	}

	func testEveryRowNamesItsReadlistToVoiceOverAndSaysWhetherItIsTicked() {
		let card = mount([.always(label: "All"), .unticked(readlist(label: "Work"))], size: Self.portrait)

		XCTAssertEqual(
			card.rows.map(\.accessibilityLabel), ["All", "Work"],
			"the row is the control VoiceOver reaches, so the readlist name has to sit on it and not on the view it hosts"
		)
		XCTAssertEqual(
			(card.rows[1] as? UIButton)?.isSelected, false,
			"an unticked row must not announce itself as selected"
		)

		tap(card.rows[1])

		XCTAssertEqual(
			(card.rows[1] as? UIButton)?.isSelected, true,
			"on a tick list, whether a row is ticked is the half of the announcement that decides the answer"
		)
		XCTAssertEqual(
			(card.rows[0] as? UIButton)?.isSelected, true,
			"the locked mainline row is permanently ticked, and must announce that rather than reading as unchosen"
		)
	}

	func testTheCardBringsNoBackdropOfItsOwn() {
		let card = mount(fullList(), size: Self.portrait)

		XCTAssertNil(
			card.view.backgroundColor,
			"the surface presenting the card already dims, so a second scrim would deepen the sheet the moment the question appears"
		)
	}

	func testEveryControlClearsTheTouchTargetFloor() {
		let card = mount(fullList(), size: Self.narrowest)

		for (index, row) in card.rows.enumerated() {
			XCTAssertGreaterThanOrEqual(
				row.frame.height, Self.touchTargetFloor,
				"row \(index) is below the 44pt floor, so the tick is hard to hit"
			)
		}
		XCTAssertGreaterThanOrEqual(card.done.frame.height, Self.touchTargetFloor)
	}

	func testDoneKeepsTheTouchTargetFloorAtTheSmallestTextSize() throws {
		guard #available(iOS 17.0, *) else { throw XCTSkip("trait overrides need iOS 17") }
		let card = ReadlistChoiceCard(drops: fullList(), onDone: { _ in })
		card.view.traitOverrides.preferredContentSizeCategory = .extraSmall
		let window = UIWindow(frame: CGRect(origin: .zero, size: Self.portrait))
		card.view.frame = window.bounds
		window.addSubview(card.view)
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		mounted.append(window)

		XCTAssertGreaterThanOrEqual(
			card.done.frame.height, Self.touchTargetFloor,
			"Done is sized by its text, so the smallest text size shrinks it below the floor unless it carries one"
		)
	}

	func testALabelAtTheServerMaximumIsNeverCompressedBelowWhatItNeeds() {
		let card = mount(fullList(), size: Self.narrowest)

		for (index, row) in card.rows.enumerated() {
			let needed = row.systemLayoutSizeFitting(
				CGSize(width: card.list.bounds.width, height: 0),
				withHorizontalFittingPriority: .required,
				verticalFittingPriority: .fittingSizeLevel
			)
			XCTAssertGreaterThanOrEqual(
				row.frame.height, needed.height,
				"row \(index) is shorter than its own label needs, so a name at the server maximum is cut off"
			)
		}
	}

	func testTheCardFitsTheNarrowestSupportedScreen() {
		let card = mount(fullList(), size: Self.narrowest)

		XCTAssertEqual(
			card.card.frame.width, Self.narrowest.width - 32, accuracy: 0.5,
			"the card keeps a 16pt margin rather than holding a width the screen cannot give it"
		)
		XCTAssertGreaterThanOrEqual(card.card.frame.minX, 16)
		XCTAssertLessThanOrEqual(card.card.frame.maxX, Self.narrowest.width - 16)
	}

	func testTheCardFitsLandscape() {
		let card = mount(fullList(), size: Self.landscape)

		XCTAssertGreaterThanOrEqual(
			card.card.frame.minY, 16,
			"landscape is a permitted orientation, so the card must not run off the top"
		)
		XCTAssertLessThanOrEqual(card.card.frame.maxY, Self.landscape.height - 16)
	}

	func testAFullListScrollsAndLeavesDoneReachable() {
		let card = mount(fullList(), size: Self.landscape)

		XCTAssertGreaterThan(
			card.scroll.contentSize.height, card.scroll.bounds.height,
			"a list too tall for the screen must scroll rather than push Done out of the card"
		)
		XCTAssertTrue(
			card.card.bounds.contains(card.done.convert(card.done.bounds, to: card.card)),
			"Done must stay inside the card when the list overflows"
		)
	}

	func testTheCardKeepsItsPreferredWidthWhenTheScreenAllowsIt() {
		let card = mount(fullList(), size: Self.portrait)

		XCTAssertEqual(
			card.card.frame.width, 340, accuracy: 0.5,
			"a screen wider than the preferred width gets the preferred width, not the whole screen"
		)
	}

	func testTheListDoesNotScrollWhenItAlreadyFits() {
		let card = mount([drop(label: "Work")], size: Self.portrait)

		XCTAssertEqual(
			card.scroll.contentSize.height, card.scroll.bounds.height, accuracy: 0.5,
			"one readlist gets the same card as six, not a scrolling one"
		)
	}

	// MARK: - Answering

	func testTickingAReadlistAndPressingDoneReturnsThatReadlist() {
		var answer: Set<Readlist>?
		let work = readlist(label: "Work")
		let card = mount([.unticked(work), .unticked(readlist(label: "Later"))], size: Self.portrait) {
			answer = $0
		}

		tap(card.rows[0])
		card.done.sendActions(for: .touchUpInside)

		XCTAssertEqual(answer, [work], "the ticked readlist is what the share is filed into")
	}

	func testPressingDoneWithNothingTickedReturnsNoReadlist() {
		var answer: Set<Readlist>?
		let card = mount(fullList(), size: Self.portrait) { answer = $0 }

		card.done.sendActions(for: .touchUpInside)

		XCTAssertEqual(answer, [], "ticking none is an answer, and it means the main readlist alone")
	}

	func testUntickingARowTakesItBackOutOfTheAnswer() {
		var answer: Set<Readlist>?
		let card = mount([.unticked(readlist(label: "Work"))], size: Self.portrait) { answer = $0 }

		tap(card.rows[0])
		tap(card.rows[0])
		card.done.sendActions(for: .touchUpInside)

		XCTAssertEqual(answer, [], "a second tap is a change of mind, not a second vote")
	}

	func testTheLockedMainlineRowCarriesNoAction() {
		var answer: Set<Readlist>?
		let card = mount([.always(label: "All"), .unticked(readlist(label: "Work"))], size: Self.portrait) {
			answer = $0
		}

		tap(card.rows[0])
		card.done.sendActions(for: .touchUpInside)

		XCTAssertEqual(
			(card.rows[0] as? UIButton)?.allTargets.count, 0,
			"every save lands in the mainline readlist already, so its row has nothing to toggle"
		)
		XCTAssertEqual(answer, [], "a tap on the locked row must not file the share anywhere")
	}

	func testDoneReportsTheAnswerOncePerTap() {
		var answers: [Set<Readlist>] = []
		let card = mount([.unticked(readlist(label: "Work"))], size: Self.portrait) { answers.append($0) }

		card.done.sendActions(for: .touchUpInside)

		XCTAssertEqual(
			answers.count, 1,
			"the extension resumes a checked continuation from this callback, and a second resume traps the process"
		)
	}

	func testTheCardAsksForEveryReadlistTheServerOffered() {
		let card = mount(fullList(), size: Self.portrait)

		XCTAssertEqual(
			card.rows.count, Self.serverDefinitionMaximum + 1,
			"the server caps a reader at seven readlists it stores plus the mainline it does not, so a maxed reader is offered eight rows"
		)
	}

	// MARK: - Pixels

	func testTheFirstRunCardLooksRightInLightMode() {
		let card = mount(fullList(), size: Self.portrait)

		assertSettled(card)
		assertMatchesBaseline(card.card, checkpoint: "first-run", style: .light)
	}

	func testTheFirstRunCardLooksRightInDarkMode() {
		let card = mount(fullList(), size: Self.portrait)

		assertSettled(card)
		assertMatchesBaseline(card.card, checkpoint: "first-run", style: .dark)
	}

	func testACardWithOneReadlistLooksRight() {
		let card = mount([.unticked(readlist(label: "Work"))], size: Self.portrait)

		assertSettled(card)
		assertMatchesBaseline(card.card, checkpoint: "one-readlist", style: .light)
	}

	func testATickedRowLooksRight() {
		let card = mount([.unticked(readlist(label: "Work")), .unticked(readlist(label: "Later"))], size: Self.portrait)
		tap(card.rows[0])
		CardCheckpoint.settle(card.view)

		assertSettled(card)
		assertMatchesBaseline(card.card, checkpoint: "ticked", style: .light)
	}

	func testEveryCheckpointHasABaselineForEveryRuntimeAlreadyCovered() {
		let directory = CardCheckpoint.baselineDirectory(for: #filePath)
		let committed = Set(CardCheckpoint.committedNames(in: directory))
		let runtimes = CardCheckpoint.coveredRuntimes(in: directory)

		XCTAssertFalse(
			runtimes.isEmpty,
			"the snapshot directory holds no baselines at all; mint them with make test RECORD_SNAPSHOTS=1"
		)
		for runtime in runtimes {
			for checkpoint in Self.checkpoints {
				let name = CardCheckpoint.baselineName(checkpoint.name, checkpoint.style, runtime: runtime)
				XCTAssertTrue(
					committed.contains(name),
					"\(name) is missing while \(runtime) has other baselines; a runtime refreshed alone leaves the rest stale"
				)
			}
		}
	}

	// MARK: - Helpers

	private func assertSettled(
		_ card: ReadlistChoiceCard,
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		assertHostIsNeutral(file: file, line: line)
		assertLayoutIsStable(card.view, card.rows + [card.done, card.card], file: file, line: line)
		for (index, row) in card.rows.enumerated() {
			XCTAssertGreaterThan(
				row.frame.height, 0,
				"row \(index) rendered with no height, so the capture would record an empty list",
				file: file, line: line
			)
		}
	}

	private func readlist(label: String) -> Readlist {
		Readlist(entry: CollectionReadlist(label: label, rel: "readlist", href: "/readlists/\(label)"))
	}

	private func drop(label: String) -> SharedArticlesDrop {
		.unticked(readlist(label: label))
	}

	private func fullList() -> [SharedArticlesDrop] {
		let longest = String(repeating: "Longreads For The Weekend", count: 1)
			.prefix(Self.serverLabelMaximum)
		var drops: [SharedArticlesDrop] = [.always(label: "All")]
		drops.append(.unticked(readlist(label: String(longest))))
		for index in drops.count..<(Self.serverDefinitionMaximum + 1) {
			drops.append(drop(label: "Readlist \(index)"))
		}
		return drops
	}

	private func tap(_ row: UIView) {
		(row as? UIButton)?.sendActions(for: .touchUpInside)
	}

	@discardableResult
	private func mount(
		_ drops: [SharedArticlesDrop],
		size: CGSize,
		onDone: @escaping (Set<Readlist>) -> Void = { _ in }
	) -> ReadlistChoiceCard {
		let card = ReadlistChoiceCard(drops: drops, onDone: onDone)
		let window = UIWindow(frame: CGRect(origin: .zero, size: size))
		card.view.frame = window.bounds
		card.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		window.addSubview(card.view)
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		mounted.append(window)
		return card
	}

	private var mounted: [UIWindow] = []
}
