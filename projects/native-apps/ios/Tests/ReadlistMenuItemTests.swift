import XCTest
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
			readlists: advertised(), selectedHref: "/queue", mainlineHref: nil, shareTargetHrefs: ["/queue"]
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
			readlists: advertised(), selectedHref: "/queue?queue=work", mainlineHref: nil, shareTargetHrefs: []
		)

		XCTAssertEqual(items.map(\.isSelected), [false, true], "the menu checkmarks the readlist the list is showing")
	}

	func testNothingIsSelectedBeforeACollectionHasNamedItsReadlist() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: nil, mainlineHref: nil, shareTargetHrefs: []
		)

		XCTAssertEqual(items.map(\.isSelected), [false, false])
	}

	func testATickedReadlistCarriesTheShareGlyphAndTheRestTheListGlyph() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue", mainlineHref: nil, shareTargetHrefs: ["/queue?queue=work"]
		)

		XCTAssertEqual(items.map(\.isShareTarget), [false, true], "the readlist shares land in is the badged one")
		XCTAssertEqual(items.map(\.badgeSystemImage), ["list.bullet", "square.and.arrow.up"])
	}

	func testEveryTickedReadlistIsBadged() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue", mainlineHref: nil, shareTargetHrefs: ["/queue", "/queue?queue=work"]
		)

		XCTAssertEqual(
			items.map(\.isShareTarget), [true, true],
			"a shared article drops into every ticked readlist, so the menu badges them all"
		)
		XCTAssertEqual(items.map(\.badgeSystemImage), ["square.and.arrow.up", "square.and.arrow.up"])
	}

	func testATickedReadlistTheServerNoLongerAdvertisesBadgesNothing() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue", mainlineHref: nil, shareTargetHrefs: ["/queue?queue=deleted"]
		)

		XCTAssertEqual(items.map(\.isShareTarget), [false, false])
		XCTAssertEqual(items.map(\.badgeSystemImage), ["list.bullet", "list.bullet"])
	}

	func testAReaderWithNoReadlistsGetsNoMenu() {
		XCTAssertEqual(
			ReadlistMenuItem.items(
				readlists: [], selectedHref: "/queue", mainlineHref: "/queue", shareTargetHrefs: ["/queue"]
			),
			[],
			"a collection that advertises no readlists offers nothing to switch between"
		)
	}

	func testTheMainlineReadlistIsBadgedWithoutAnyoneTickingIt() {
		let items = ReadlistMenuItem.items(
			readlists: advertised(), selectedHref: "/queue", mainlineHref: "/queue", shareTargetHrefs: []
		)

		XCTAssertEqual(
			items.map(\.isShareTarget), [true, false],
			"a shared article lands in the whole queue whatever else is ticked, so the menu says so"
		)
		XCTAssertEqual(items.map(\.badgeSystemImage), ["square.and.arrow.up", "list.bullet"])
	}
}
