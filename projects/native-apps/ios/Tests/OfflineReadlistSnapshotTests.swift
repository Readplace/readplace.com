import XCTest
@testable import Readplace

final class OfflineReadlistSnapshotTests: XCTestCase {
	private let container = AppGroupContainer(url: TestSupport.temporaryContainer())

	private func page(_ json: String) throws -> ReadlistPage {
		let body = Data(json.utf8)
		return ReadlistPage(collection: try JSONDecoder().decode(SirenCollection.self, from: body), sirenBody: body)
	}

	func testAPageKeptUnderItsHrefIsReadBackAsAStoredCopy() throws {
		let snapshot = OfflineReadlistSnapshot(container: container)
		snapshot.save(try page(Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")])), href: "/queue?status=unread", savedAt: Date())

		let stored = try XCTUnwrap(OfflineReadlistSnapshot(container: container).page(href: "/queue?status=unread", now: Date()))

		XCTAssertEqual(stored.articles.map(\.id), ["a1"], "a later launch reads what an earlier one kept")
		XCTAssertTrue(stored.isStoredCopy, "the list must know it is showing a copy, not the server's answer")
		XCTAssertNil(snapshot.page(href: "/queue?status=read", now: Date()), "each href keeps its own page")
	}

	func testTheEntryPointsPageIsAlsoKeptUnderTheTabItLanded() throws {
		let landed = try page(Fixtures.collection(
			entitiesJSON: [Fixtures.article(id: "a1")], tabsJSON: Fixtures.tabs(current: "unread")
		))
		let snapshot = OfflineReadlistSnapshot(container: container)

		snapshot.save(landed, href: nil, savedAt: Date())

		XCTAssertEqual(snapshot.page(href: nil, now: Date())?.articles.map(\.id), ["a1"])
		XCTAssertEqual(
			snapshot.page(href: "/queue?status=unread", now: Date())?.articles.map(\.id), ["a1"],
			"the next launch opens on the remembered landing tab, which the entry point redirected to"
		)
	}

	func testAPageKeptMoreThanThirtyDaysAgoIsNotShown() throws {
		let snapshot = OfflineReadlistSnapshot(container: container)
		let savedAt = Date(timeIntervalSince1970: 1_000_000)
		snapshot.save(try page(Fixtures.collection(entitiesJSON: [])), href: "/queue", savedAt: savedAt)

		XCTAssertNotNil(snapshot.page(href: "/queue", now: savedAt.addingTimeInterval(30 * 24 * 60 * 60)))
		XCTAssertNil(snapshot.page(href: "/queue", now: savedAt.addingTimeInterval(30 * 24 * 60 * 60 + 1)))
	}

	func testAPageWithNoBodyToKeepIsNotKept() throws {
		let snapshot = OfflineReadlistSnapshot(container: container)
		let decoded = try JSONDecoder().decode(SirenCollection.self, from: Data(Fixtures.collection(entitiesJSON: []).utf8))

		snapshot.save(ReadlistPage(collection: decoded), href: "/queue", savedAt: Date())

		XCTAssertNil(snapshot.page(href: "/queue", now: Date()))
	}

	func testPurgingRemovesEveryKeptPage() throws {
		let snapshot = OfflineReadlistSnapshot(container: container)
		snapshot.save(try page(Fixtures.collection(entitiesJSON: [])), href: "/queue", savedAt: Date())

		OfflineReadingFiles.purge(in: container)

		XCTAssertNil(snapshot.page(href: "/queue", now: Date()))
	}
}
