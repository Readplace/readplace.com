import XCTest
@testable import Readplace

final class SirenDecodingTests: XCTestCase {
	private func decodeCollection(_ json: String) throws -> SirenCollection {
		try JSONDecoder().decode(SirenCollection.self, from: Data(json.utf8))
	}

	private func decodeEntity(_ json: String) throws -> SirenEntity {
		try JSONDecoder().decode(SirenEntity.self, from: Data(json.utf8))
	}

	func testRichArticleMapsAllFields() throws {
		let entity = try decodeEntity(Fixtures.article())
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertEqual(article.id, "a1")
		XCTAssertEqual(article.url, "https://example.com/post")
		XCTAssertEqual(article.title, "A Title")
		XCTAssertEqual(article.siteName, "Example")
		XCTAssertEqual(article.excerpt, "An excerpt.")
		XCTAssertEqual(article.imageURL?.absoluteString, "https://example.com/img.png")
		XCTAssertEqual(article.readTimeMinutes, 6)
		XCTAssertFalse(article.isRead)
		XCTAssertEqual(article.updateStatusAction?.name, "update-status")
		XCTAssertEqual(article.updateStatusAction?.href, "/queue/a1/status")
		XCTAssertEqual(article.updateStatusAction?.method, "POST")
		XCTAssertEqual(article.updateStatusAction?.type, "application/x-www-form-urlencoded")
		XCTAssertEqual(article.updateStatusAction?.fields?.first?.name, "status")
		XCTAssertEqual(article.readHref, "/queue/a1/view")
		XCTAssertNotNil(article.savedAt)
	}

	func testNullImageAndReadAtAreTolerated() throws {
		let entity = try decodeEntity(Fixtures.article(imageUrl: nil, readAt: nil))
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertNil(article.imageURL)
		XCTAssertFalse(article.isRead)
	}

	func testStatusReadMarksAsRead() throws {
		let entity = try decodeEntity(Fixtures.article(status: "read"))
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertTrue(article.isRead)
	}

	func testReadAtImpliesReadEvenWhenStatusUnread() throws {
		let entity = try decodeEntity(Fixtures.article(status: "unread", readAt: "2026-05-31T09:00:00.000Z"))
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertTrue(article.isRead)
	}

	func testMinimalEntityFallsBackTitleToURL() throws {
		let json = """
		{ "properties": { "id": "x", "url": "https://example.com/x" } }
		"""
		let article = try XCTUnwrap(Article(entity: try decodeEntity(json)))
		XCTAssertEqual(article.title, "https://example.com/x")
		XCTAssertNil(article.siteName)
		XCTAssertNil(article.updateStatusAction)
		XCTAssertNil(article.readHref)
	}

	func testUpdateStatusActionDecodesWithFieldValue() throws {
		let json = """
		{ "name": "update-status", "href": "/queue/a1/status", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "status", "type": "text", "value": "read" }] }
		"""
		let action = try JSONDecoder().decode(SirenAction.self, from: Data(json.utf8))
		XCTAssertEqual(action.name, "update-status")
		XCTAssertEqual(action.fields?.first?.name, "status")
		XCTAssertEqual(action.fields?.first?.value, "read")
	}

	func testEmptyTitleFallsBackToURL() throws {
		let article = try XCTUnwrap(Article(entity: try decodeEntity(Fixtures.article(title: ""))))
		XCTAssertEqual(article.title, "https://example.com/post")
	}

	func testEntityWithoutPropertiesYieldsNil() throws {
		let json = """
		{ "class": ["article"], "links": [] }
		"""
		XCTAssertNil(Article(entity: try decodeEntity(json)))
	}

	func testHrefLessLinkAndActionDecodeAndAreUnactionable() throws {
		// A link or action the server advertises without an href must not fail the
		// decode; it is simply kept and treated as unactionable.
		let json = """
		{ "properties": { "id": "x", "url": "https://example.com/x" },
		  "links": [{ "rel": ["read"] }],
		  "actions": [{ "name": "update-status", "method": "POST" }] }
		"""
		let article = try XCTUnwrap(Article(entity: try decodeEntity(json)))
		XCTAssertNil(article.readHref, "a read link with no href leaves the row unopenable")
		XCTAssertFalse(article.canMarkRead, "an action with no href offers no mark-read affordance")
	}

	func testCollectionDropsUnusableEntities() throws {
		let json = Fixtures.collection(entitiesJSON: [
			Fixtures.article(id: "good"),
			"{ \"class\": [\"article\"] }",
		], total: 2)
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(page.articles.map(\.id), ["good"])
	}

	func testCollectionExposesActionsAndTotal() throws {
		let json = Fixtures.collection(entitiesJSON: [Fixtures.article()], total: 7)
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(page.total, 7)
		XCTAssertEqual(page.saveHtmlAction?.href, "/queue/save-html")
		XCTAssertEqual(page.saveHtmlAction?.method, "POST")
		XCTAssertEqual(page.saveHtmlAction?.type, "application/json")
		XCTAssertEqual(page.saveArticleAction?.href, "/queue")
		XCTAssertEqual(page.selfHref, "/queue?page=1")
	}

	func testPaginationLinks() throws {
		let withNext = Fixtures.collection(
			entitiesJSON: [Fixtures.article()],
			extraLinks: ", { \"rel\": [\"next\"], \"href\": \"/queue?page=2\" }, { \"rel\": [\"prev\"], \"href\": \"/queue?page=1\" }",
			page: 1
		)
		let page = QueuePage(collection: try decodeCollection(withNext))
		XCTAssertEqual(page.nextHref, "/queue?page=2")
		XCTAssertEqual(page.prevHref, "/queue?page=1")

		let noNext = Fixtures.collection(entitiesJSON: [Fixtures.article()])
		let lastPage = QueuePage(collection: try decodeCollection(noNext))
		XCTAssertNil(lastPage.nextHref)
		XCTAssertNil(lastPage.prevHref)
	}

	func testAddLinksHelpLinkDecodes() throws {
		let withHelp = Fixtures.collection(
			entitiesJSON: [Fixtures.article()],
			extraLinks: ", { \"rel\": [\"add-links-help\"], \"href\": \"/help/add-links\" }"
		)
		let page = QueuePage(collection: try decodeCollection(withHelp))
		XCTAssertEqual(page.addLinksHelpHref, "/help/add-links")

		let withoutHelp = Fixtures.collection(entitiesJSON: [Fixtures.article()])
		XCTAssertNil(QueuePage(collection: try decodeCollection(withoutHelp)).addLinksHelpHref)
	}

	func testEmptyCollection() throws {
		let json = """
		{ "class": ["collection", "articles"], "properties": { "total": 0, "page": 1, "pageSize": 20 }, "links": [{ "rel": ["self"], "href": "/queue" }], "actions": [] }
		"""
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertTrue(page.articles.isEmpty)
		XCTAssertNil(page.nextHref)
	}

	func testCollectionWarningSurfaced() throws {
		let json = """
		{ "class": ["collection", "articles"], "properties": { "total": 0, "page": 1, "pageSize": 20, "warning": { "code": "not-saveable", "message": "Cannot save that link." } }, "links": [], "actions": [] }
		"""
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(page.warning?.code, "not-saveable")
		XCTAssertEqual(page.warning?.message, "Cannot save that link.")
	}

	func testSirenDateParsesWithAndWithoutFractionalSeconds() {
		XCTAssertNotNil(SirenDate.parse("2026-05-30T10:00:00.123Z"))
		XCTAssertNotNil(SirenDate.parse("2026-05-30T10:00:00Z"))
		XCTAssertNil(SirenDate.parse("not-a-date"))
		XCTAssertNil(SirenDate.parse(""))
	}

	func testSirenErrorDecodesWithFallbackAction() throws {
		let json = Fixtures.sirenError(code: "html-too-large", message: "Too big", withSaveArticleFallback: true)
		let error = try JSONDecoder().decode(SirenError.self, from: Data(json.utf8))
		XCTAssertEqual(error.properties.code, "html-too-large")
		XCTAssertEqual(error.actions?.first?.name, "save-article")
		XCTAssertEqual(error.actions?.first?.href, "/queue")
	}

	func testSirenErrorDecodesWithoutActions() throws {
		let json = Fixtures.sirenError(code: "invalid-save-html", message: "Bad", withSaveArticleFallback: false)
		let error = try JSONDecoder().decode(SirenError.self, from: Data(json.utf8))
		XCTAssertEqual(error.properties.code, "invalid-save-html")
		XCTAssertNil(error.actions)
	}
}
