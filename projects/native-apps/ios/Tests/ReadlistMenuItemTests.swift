import XCTest
import SwiftUI
@testable import Readplace

final class ReadlistMenuItemTests: XCTestCase {
	private func readlist(label: String, href: String) -> Readlist {
		Readlist(entry: CollectionReadlist(label: label, rel: "readlist", href: href))
	}

	private func advertised() -> [Readlist] {
		[readlist(label: "All", href: "/queue"), readlist(label: "Work", href: "/queue?queue=work")]
	}

	func testEachAdvertisedReadlistBecomesAnItemKeyedOnItsHref() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue", shareTargetHref: "/queue"
		)

		XCTAssertEqual(items.map(\.label), ["All", "Work"], "labels are the server's, in wire order")
		XCTAssertEqual(items.map(\.href), ["/queue", "/queue?queue=work"])
		XCTAssertEqual(
			items.map(\.id), items.map(\.href),
			"an item's identity is its href — the value the picker's tag must equal"
		)
	}

	func testOnlyTheReadlistOnScreenIsSelected() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue?queue=work", shareTargetHref: nil
		)

		XCTAssertEqual(items.map(\.isSelected), [false, true], "the menu checkmarks the readlist the list is showing")
	}

	func testNothingIsSelectedBeforeACollectionHasNamedItsReadlist() {
		let items = ReadlistMenuItem.items(readlists: advertised(), selectedHref: nil, shareTargetHref: nil)

		XCTAssertEqual(items.map(\.isSelected), [false, false])
	}

	func testTheShareTargetCarriesTheShareGlyphAndTheRestTheListGlyph() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue", shareTargetHref: "/queue?queue=work"
		)

		XCTAssertEqual(items.map(\.isShareTarget), [false, true], "the readlist shares land in is the badged one")
		XCTAssertEqual(items.map(\.badgeSystemImage), ["list.bullet", "square.and.arrow.up"])
	}

	func testAShareTargetTheServerNoLongerAdvertisesBadgesNothing() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue", shareTargetHref: "/queue?queue=deleted"
		)

		XCTAssertEqual(items.map(\.isShareTarget), [false, false])
		XCTAssertEqual(items.map(\.badgeSystemImage), ["list.bullet", "list.bullet"])
	}

	func testAReaderWithNoReadlistsGetsNoMenu() {
		XCTAssertEqual(
			ReadlistMenuItem.items(readlists: [], selectedHref: "/queue", shareTargetHref: "/queue"), [],
			"a collection that advertises no readlists offers nothing to switch between"
		)
	}

	func testTheCheckboxSaysWhetherSharedArticlesDropIntoTheReadlistOnScreen() {
		XCTAssertEqual(SharedArticlesDropPresentation.title(isOn: true), "Shared articles drop here")
		XCTAssertEqual(SharedArticlesDropPresentation.title(isOn: false), "Want shared article to drop here?")
	}

	func testAnEmptyBoxReadsAsUntickedAndATickedOneAsFilled() {
		XCTAssertEqual(SharedArticlesDropPresentation.boxSystemImage(isOn: true), "checkmark.square.fill")
		XCTAssertEqual(SharedArticlesDropPresentation.boxSystemImage(isOn: false), "square")
		XCTAssertEqual(SharedArticlesDropPresentation.boxTint(isOn: true), Color.brandSuccessText)
		XCTAssertEqual(SharedArticlesDropPresentation.boxTint(isOn: false), Color.brandTextSecondary)
		XCTAssertEqual(SharedArticlesDropPresentation.titleTint(isOn: true), Color.brandTextPrimary)
		XCTAssertEqual(SharedArticlesDropPresentation.titleTint(isOn: false), Color.brandTextSecondary)
	}
}
