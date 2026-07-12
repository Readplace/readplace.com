import XCTest
@testable import Readplace

final class SirenDecodingTests: XCTestCase {
	/// A fixed UTC instant, for asserting a parsed date equals a known point in
	/// time rather than merely being non-nil.
	static func utc(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int, _ second: Int) -> Date {
		var calendar = Calendar(identifier: .gregorian)
		calendar.timeZone = TimeZone(identifier: "UTC")!
		return calendar.date(from: DateComponents(
			year: year, month: month, day: day, hour: hour, minute: minute, second: second
		))!
	}

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
		let updateStatus = try XCTUnwrap(article.actions.first { $0.name == "update-status" })
		XCTAssertEqual(updateStatus.href, "/queue/a1/status")
		XCTAssertEqual(updateStatus.method, "POST")
		XCTAssertEqual(updateStatus.type, "application/x-www-form-urlencoded")
		XCTAssertEqual(updateStatus.fields?.first?.name, "status")
		XCTAssertEqual(article.readHref, "/queue/a1/view")
		XCTAssertEqual(article.savedAt, SirenDecodingTests.utc(2026, 5, 30, 10, 0, 0),
			"the fixture's savedAt (2026-05-30T10:00:00.000Z) parses to that exact instant")
	}

	func testArticleAffordancesIterateAdvertisedActionsInWireOrder() throws {
		// One control per advertised, invokable action — built by iterating, never
		// by matching a known name — so a newly-advertised item action renders.
		let json = """
		{ "properties": { "id": "x", "url": "https://example.com/x" },
		  "actions": [
		    { "name": "update-status", "title": "Mark read", "href": "/queue/x/status", "method": "POST" },
		    { "name": "delete", "title": "Delete", "href": "/queue/x/delete", "method": "POST" },
		    { "name": "archive", "title": "Archive", "href": "/queue/x/archive", "method": "POST" }
		  ] }
		"""
		let article = try XCTUnwrap(Article(entity: try decodeEntity(json)))
		XCTAssertEqual(
			article.affordances.map(\.token), ["update-status", "delete", "archive"],
			"a never-before-seen action (archive) still becomes a control via the loop"
		)
		XCTAssertEqual(article.affordances.map(\.label), ["Mark read", "Delete", "Archive"])
	}

	func testRowControlsDropAFieldRequiringItemActionWithNoServerValue() throws {
		// A future item action that requires a field the server didn't pre-fill is not
		// invokable from a bare control, so the row must not surface it as a swipe that
		// would error on tap. `delete` (field-less) and `update-status` (its only field
		// carries a server value) stay.
		let json = """
		{ "properties": { "id": "x", "url": "https://example.com/x" },
		  "actions": [
		    { "name": "update-status", "title": "Mark read", "href": "/queue/x/status", "method": "POST", "fields": [{ "name": "status", "type": "text", "value": "read" }] },
		    { "name": "delete", "title": "Delete", "href": "/queue/x/delete", "method": "POST" },
		    { "name": "annotate", "title": "Annotate", "href": "/queue/x/annotate", "method": "POST", "fields": [{ "name": "note", "type": "text" }] }
		  ] }
		"""
		let article = try XCTUnwrap(Article(entity: try decodeEntity(json)))
		XCTAssertEqual(
			article.affordances.map(\.token), ["update-status", "delete", "annotate"],
			"every advertised item action with an href becomes an affordance"
		)
		XCTAssertEqual(
			article.rowControls.map(\.token), ["update-status", "delete"],
			"a field-requiring item action with no server value is not bare-invokable, so the row drops it"
		)
	}

	func testRowControlsSurfaceASemanticLinkButNotTheReadOrStructuralLinks() throws {
		// Every non-structural, non-`read` item link becomes a discrete row control, so
		// a future item link (e.g. `share`) renders instead of being discarded — while
		// the `read` link (the row's primary tap target) and structural plumbing (an
		// `item` link) stay out.
		let json = """
		{ "properties": { "id": "x", "url": "https://example.com/x" },
		  "links": [
		    { "rel": ["read"], "href": "/queue/x/view", "title": "Read" },
		    { "rel": ["item"], "href": "/queue/x" },
		    { "rel": ["share"], "href": "/queue/x/share", "title": "Share" }
		  ] }
		"""
		let article = try XCTUnwrap(Article(entity: try decodeEntity(json)))
		XCTAssertEqual(
			article.rowControls.compactMap(\.link).map { $0.rel.first }, ["share"],
			"the semantic share link is surfaced; the read tap-target and the structural item link are not"
		)
		XCTAssertEqual(article.readHref, "/queue/x/view", "the read link still drives the row's primary tap target")
	}

	func testAffordanceLabelFallsBackToHumanizedTokenWhenServerSendsNoTitle() throws {
		let action = SirenAction(name: "update-status", href: "/x", method: "POST", title: nil, type: nil, fields: nil)
		let affordance = try XCTUnwrap(Affordance(action: action))
		XCTAssertEqual(
			affordance.label, "Update Status",
			"a title-less action renders a humanized token, not the raw wire slug"
		)
	}

	func testNullImageAndReadAtAreTolerated() throws {
		let entity = try decodeEntity(Fixtures.article(imageUrl: nil, readAt: nil))
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertNil(article.imageURL)
		XCTAssertFalse(article.isRead)
	}

	// The next two exercise the fallback derivation used only for an older server
	// that doesn't emit the explicit read-state (the fixture omits `isRead`).
	func testStatusReadMarksAsReadWhenServerOmitsIsRead() throws {
		let entity = try decodeEntity(Fixtures.article(status: "read"))
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertTrue(article.isRead)
	}

	func testReadAtImpliesReadWhenServerOmitsIsRead() throws {
		let entity = try decodeEntity(Fixtures.article(status: "unread", readAt: "2026-05-31T09:00:00.000Z"))
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertTrue(article.isRead)
	}

	func testServerIsReadWinsOverTheStatusVocabulary() throws {
		// The server says not-read even though `status` is "read": the explicit
		// boolean is the client's read-state, not the status literal.
		let entity = try decodeEntity(Fixtures.article(status: "read", isRead: false))
		let article = try XCTUnwrap(Article(entity: entity))
		XCTAssertFalse(article.isRead)
	}

	func testServerIsReadTrueMarksReadRegardlessOfStatus() throws {
		let entity = try decodeEntity(Fixtures.article(status: "unread", readAt: nil, isRead: true))
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
		XCTAssertTrue(article.affordances.isEmpty, "no advertised actions ⇒ no item controls")
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

	func testActionWithoutMethodDefaultsToGET() throws {
		// Siren defaults an action's method to GET when omitted; a method-less but
		// otherwise valid action must decode (as GET), never fail the surrounding decode.
		let json = """
		{ "name": "search", "href": "/queue" }
		"""
		let action = try JSONDecoder().decode(SirenAction.self, from: Data(json.utf8))
		XCTAssertEqual(action.method, "GET")
	}

	func testFieldDecodesAStringValue() throws {
		let json = """
		{ "name": "status", "type": "text", "value": "read" }
		"""
		let field = try JSONDecoder().decode(SirenField.self, from: Data(json.utf8))
		XCTAssertEqual(field.value, "read")
	}

	func testFieldCoercesAWholeNumberValueToAStringWithoutADecimalPoint() throws {
		// A server may declare a numeric field value (e.g. "page": 2); coerce it to its
		// string form so the generic invoker posts "2", not "2.0", and the value isn't
		// dropped.
		let json = """
		{ "name": "page", "type": "number", "value": 2 }
		"""
		let field = try JSONDecoder().decode(SirenField.self, from: Data(json.utf8))
		XCTAssertEqual(field.value, "2")
	}

	func testFieldCoercesAFractionalNumberValueToAString() throws {
		let json = """
		{ "name": "ratio", "type": "number", "value": 1.5 }
		"""
		let field = try JSONDecoder().decode(SirenField.self, from: Data(json.utf8))
		XCTAssertEqual(field.value, "1.5")
	}

	func testFieldWithNoValueDecodesAsNil() throws {
		let json = """
		{ "name": "url", "type": "url" }
		"""
		let field = try JSONDecoder().decode(SirenField.self, from: Data(json.utf8))
		XCTAssertNil(field.value)
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
		XCTAssertTrue(
			article.affordances.isEmpty,
			"an action with no href is kept but unactionable, so it produces no control"
		)
	}

	func testCollectionDropsUnusableEntities() throws {
		let json = Fixtures.collection(entitiesJSON: [
			Fixtures.article(id: "good"),
			"{ \"class\": [\"article\"] }",
		], total: 2)
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(page.articles.map(\.id), ["good"])
	}

	func testCollectionDropsAMalformedActionButKeepsValidOnes() throws {
		// One malformed action (missing the required `name`) is dropped, not allowed
		// to blank the whole page — every other advertised control still renders. The
		// page loops all advertised actions, so atomic decoding would let one bad
		// action take down the collection.
		let valid = "{ \"name\": \"save-article\", \"title\": \"Save a link\", \"href\": \"/queue\", \"method\": \"POST\" }"
		let malformed = "{ \"href\": \"/x\", \"method\": \"POST\" }"
		let json = Fixtures.collection(entitiesJSON: [Fixtures.article()], actionsJSON: "\(valid), \(malformed)")
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(
			page.affordances.compactMap(\.action).map(\.name), ["save-article"],
			"a malformed action is dropped; the valid ones still render"
		)
	}

	func testCollectionDropsAMalformedEntityButKeepsValidOnes() throws {
		// An entity whose properties are present but malformed (missing the required
		// `id`) is dropped at decode rather than failing the whole collection —
		// distinct from an entity with no properties at all (above), which decodes
		// fine and is dropped later by Article.init?.
		let malformedEntity = "{ \"properties\": { \"url\": \"https://example.com/x\" } }"
		let json = Fixtures.collection(entitiesJSON: [Fixtures.article(id: "good"), malformedEntity], total: 2)
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(page.articles.map(\.id), ["good"], "a malformed entity is dropped, not page-blanking")
	}

	func testCollectionDropsAMalformedLinkButKeepsPagination() throws {
		// A malformed link (missing the required `rel`) is dropped while the valid
		// navigation links still resolve, so one bad link can't break pagination.
		let json = Fixtures.collection(
			entitiesJSON: [Fixtures.article()],
			extraLinks: ", { \"href\": \"/broken\" }, { \"rel\": [\"next\"], \"href\": \"/queue?page=2\" }",
			page: 1
		)
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(page.nextHref, "/queue?page=2", "a malformed link is dropped; valid links still resolve")
	}

	func testCollectionExposesAffordances() throws {
		let json = Fixtures.collection(entitiesJSON: [Fixtures.article()])
		let page = QueuePage(collection: try decodeCollection(json))
		// The complete set of advertised collection actions, labelled by the server's
		// title. The toolbar derives its own presentable subset from this client-side;
		// the share-sheet save journey resolves its bespoke action from it by name.
		let actionAffordances = page.affordances.filter { $0.action != nil }
		XCTAssertEqual(
			actionAffordances.compactMap(\.action).map(\.name),
			["save-article", "save-html", "save-content", "search"]
		)
		XCTAssertEqual(
			actionAffordances.map(\.label),
			["Save a link", "Save a page", "Save a file", "Search"]
		)
	}

	func testCollectionActionNamedSelectsTheBespokeSaveActionForTheShareSheet() throws {
		// The share-sheet save journey still resolves a specific save action by name
		// to build its bespoke body — the contract's sanctioned exception for
		// special-body actions, distinct from the looped toolbar rendering.
		let json = Fixtures.collection(entitiesJSON: [Fixtures.article()])
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertEqual(page.action(named: "save-html")?.href, "/queue/save-html")
		XCTAssertEqual(page.action(named: "save-article")?.href, "/queue")
		XCTAssertNil(page.action(named: "no-such-action"))
	}

	func testCollectionAffordancesIncludeNavigableLinksWithUsableHref() throws {
		// A navigable save link the server might advertise becomes a toolbar control
		// too, keyed on its rel — opened, not invoked.
		let withSave = Fixtures.collection(
			entitiesJSON: [Fixtures.article()],
			extraLinks: ", { \"rel\": [\"save\"], \"href\": \"/save\", \"title\": \"Save a link\" }"
		)
		let page = QueuePage(collection: try decodeCollection(withSave))
		let saveLink = try XCTUnwrap(page.affordances.first { $0.link?.rel.first == "save" })
		XCTAssertEqual(saveLink.label, "Save a link")
		XCTAssertEqual(saveLink.link?.href, "/save")
	}

	func testPaginationLinks() throws {
		let withNext = Fixtures.collection(
			entitiesJSON: [Fixtures.article()],
			extraLinks: ", { \"rel\": [\"next\"], \"href\": \"/queue?page=2\" }",
			page: 1
		)
		let page = QueuePage(collection: try decodeCollection(withNext))
		XCTAssertEqual(page.nextHref, "/queue?page=2")

		let noNext = Fixtures.collection(entitiesJSON: [Fixtures.article()])
		let lastPage = QueuePage(collection: try decodeCollection(noNext))
		XCTAssertNil(lastPage.nextHref)
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

	func testCollectionWarningWithoutACodeStillSurfacesItsMessage() throws {
		// `code` is optional: the client renders only the message, so a warning whose
		// classifier the client doesn't read — or a server that drops the code — still
		// surfaces the warning text rather than swallowing it.
		let json = """
		{ "class": ["collection", "articles"], "properties": { "total": 0, "page": 1, "pageSize": 20, "warning": { "message": "Cannot save that link." } }, "links": [], "actions": [] }
		"""
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertNil(page.warning?.code, "a code-less warning still decodes")
		XCTAssertEqual(page.warning?.message, "Cannot save that link.")
	}

	func testMalformedCollectionWarningDegradesToNoBannerWithoutBlankingThePage() throws {
		// The warning is a non-fatal channel: an evolved or malformed warning — here one
		// that dropped its required `message` — must degrade to no banner, never fail
		// the whole collection decode and blank the list.
		let json = """
		{ "class": ["collection", "articles"],
		  "properties": { "total": 1, "page": 1, "pageSize": 20, "warning": { "code": "not-saveable" } },
		  "entities": [\(Fixtures.article(id: "a1"))],
		  "links": [], "actions": [] }
		"""
		let page = QueuePage(collection: try decodeCollection(json))
		XCTAssertNil(page.warning, "a warning missing its required message degrades to no banner")
		XCTAssertEqual(page.articles.map(\.id), ["a1"], "and the rest of the collection still decodes")
	}

	func testSirenDateParsesWithAndWithoutFractionalSeconds() throws {
		let base = SirenDecodingTests.utc(2026, 5, 30, 10, 0, 0)
		XCTAssertEqual(try XCTUnwrap(SirenDate.parse("2026-05-30T10:00:00Z")), base)
		let fractional = try XCTUnwrap(SirenDate.parse("2026-05-30T10:00:00.123Z"))
		XCTAssertEqual(fractional.timeIntervalSince(base), 0.123, accuracy: 0.0005,
			"the fractional variant is 123 ms after the whole-second instant")
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
