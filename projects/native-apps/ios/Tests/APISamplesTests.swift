import XCTest
@testable import Readplace

final class APISamplesTests: XCTestCase {
	private let siren = "application/vnd.siren+json"
	private let collectionJSON = #"{"class":["collection"],"actions":[{"name":"save-article","href":"/queue","method":"POST","type":"application/json"}]}"#
	private let articleJSON = #"{"class":["article"],"properties":{"url":"https://example.com/a"}}"#

	private let session = URLSession(configuration: TestSupport.stubbedConfiguration())

	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	override func tearDown() {
		session.invalidateAndCancel()
		StubURLProtocol.reset()
		super.tearDown()
	}

	private func origin() throws -> URL {
		try XCTUnwrap(URL(string: "https://readplace.test"))
	}

	private func collection(type: String?) -> ReadplaceCollection {
		ReadplaceCollection(actions: [ReadplaceAction(name: "save-article", href: "/queue", method: "POST", type: type)])
	}

	func testDiscoverFollowsTheRedirectResendingTheTokenAndAccept() async throws {
		StubURLProtocol.setHandler { [collectionJSON] request, _ in
			request.url?.path == "/queue" ? .json(200, collectionJSON) : .redirect(to: "/queue")
		}

		let discovered = try await discover(origin: try origin(), token: "token-1", session: session)

		XCTAssertEqual(discovered.actions.map(\.name), ["save-article"])
		let queue = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first)
		XCTAssertEqual(queue.request.value(forHTTPHeaderField: "Authorization"), "Bearer token-1")
		XCTAssertEqual(queue.request.value(forHTTPHeaderField: "Accept"), siren)
	}

	func testDiscoverThrowsTheStatusTheCollectionAnswered() async throws {
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/queue" ? .json(401, "{}") : .redirect(to: "/queue")
		}

		do {
			_ = try await discover(origin: try origin(), token: "token-1", session: session)
			XCTFail("discover returned a collection for a 401")
		} catch let error as ReadplaceAPIError {
			XCTAssertEqual(error, .unexpectedStatus(401))
		}
	}

	func testSaveArticlePostsJSONToTheAdvertisedHref() async throws {
		StubURLProtocol.setHandler { [articleJSON] _, _ in .json(201, articleJSON) }

		let saved = try await saveArticle(collection: collection(type: "application/json"), origin: try origin(), token: "token-1", url: "https://example.com/a", readlists: ["/readlists/r1"], session: session)

		XCTAssertEqual(saved.class, ["article"])
		XCTAssertEqual(saved.properties.url, "https://example.com/a")
		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first)
		XCTAssertEqual(record.request.httpMethod, "POST")
		XCTAssertEqual(record.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
		XCTAssertEqual(record.request.value(forHTTPHeaderField: "Prefer"), "return=representation")
		XCTAssertEqual(record.request.value(forHTTPHeaderField: "Authorization"), "Bearer token-1")
		XCTAssertEqual(record.request.value(forHTTPHeaderField: "Accept"), siren)
		let body = try XCTUnwrap(JSONSerialization.jsonObject(with: record.body) as? [String: AnyHashable])
		XCTAssertEqual(body, ["url": "https://example.com/a", "readlists": ["/readlists/r1"]])
	}

	func testSaveArticleOmitsReadlistsWhenNoneAreGiven() async throws {
		StubURLProtocol.setHandler { [articleJSON] _, _ in .json(201, articleJSON) }

		_ = try await saveArticle(collection: collection(type: nil), origin: try origin(), token: "token-1", url: "https://example.com/a", session: session)

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first)
		XCTAssertEqual(record.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
		let body = try XCTUnwrap(JSONSerialization.jsonObject(with: record.body) as? [String: AnyHashable])
		XCTAssertEqual(body, ["url": "https://example.com/a"])
	}

	func testSaveArticleThrowsWhenTheCollectionAdvertisesNoSaveAction() async throws {
		do {
			_ = try await saveArticle(collection: ReadplaceCollection(actions: []), origin: try origin(), token: "token-1", url: "https://example.com/a", session: session)
			XCTFail("saveArticle saved without a save-article action")
		} catch let error as ReadplaceAPIError {
			XCTAssertEqual(error, .missingAction("save-article"))
		}
		XCTAssertTrue(StubURLProtocol.records.isEmpty)
	}
}
