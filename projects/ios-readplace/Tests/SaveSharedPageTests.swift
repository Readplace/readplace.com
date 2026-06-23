import XCTest
@testable import Readplace

/// End-to-end coverage of the share-save journey: `SaveSharedPage.run` drives the
/// real capture → list → save decision tree through the production API and token
/// types, with the page capture faked by `FakeHTMLCaptor` and the network by
/// `StubURLProtocol`.
@MainActor
final class SaveSharedPageTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeAPI(store: TokenStore) -> ReadplaceAPI {
		ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
	}

	func testSavesRenderedHTMLWhenUnderCap() async throws {
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured"))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/queue/save-html":
				return .json(201, Fixtures.article(id: "saved", url: "https://example.com/post"))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil)

		XCTAssertEqual(outcome, .savedWithContent)
		XCTAssertEqual(captor.capturedURLs, [URL(string: "https://example.com/post")!])

		let saveHtmlRecords = StubURLProtocol.records(path: "/queue/save-html")
		XCTAssertEqual(saveHtmlRecords.count, 1)
		let body = TestSupport.jsonObject(try XCTUnwrap(saveHtmlRecords.first).body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/post")
		XCTAssertEqual(body["rawHtml"] as? String, "<html><body>hi</body></html>")
		XCTAssertEqual(body["title"] as? String, "Captured")

		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertTrue(queuePosts.isEmpty, "must not also POST the URL-only save when save-html succeeds")
	}

	func testRefusesWhenServerRefusesTheSave() async throws {
		// The server refuses the save with a message-only error (e.g. a locked
		// account). The share-save journey — the path the user actually takes from
		// the Share Sheet — must surface it as `.refused` so the shell shows the
		// server's message, not the generic "Save failed."; and the refusal must not
		// fall back to a URL-only save.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured"))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/queue/save-html":
				return .json(403, Fixtures.accountLockedError())
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil)

		guard case let .refused(messages) = outcome else {
			return XCTFail("expected .refused, got \(outcome)")
		}
		XCTAssertEqual(messages.first?.content.type, "text/html")
		XCTAssertTrue(
			messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false,
			"the refusal must carry the server's contact message verbatim"
		)
		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertTrue(queuePosts.isEmpty, "a refusal must not fall back to a URL-only save")
	}

	func testDegradesToLinkOnlyWhenCaptureEmpty() async throws {
		// The capture produced no HTML, so the orchestrator saves URL-only.
		let store = TestSupport.loggedInStore()
		let emptyCaptor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return request.httpMethod == "POST"
					? .json(201, Fixtures.article(id: "url-saved"))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: emptyCaptor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: "Shared title")

		XCTAssertEqual(outcome, .savedLinkOnly)
		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertEqual(queuePosts.count, 1)
		let body = TestSupport.jsonObject(try XCTUnwrap(queuePosts.first).body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/post")
		XCTAssertNil(body["rawHtml"], "the URL-only save must not carry rawHtml")
		XCTAssertTrue(StubURLProtocol.records(path: "/queue/save-html").isEmpty)
	}

	func testDegradesToLinkOnlyWhenHTMLOverCap() async throws {
		// The capture produced HTML, but it exceeds the server's byte cap, so the
		// orchestrator skips save-html and saves URL-only instead.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured"))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return request.httpMethod == "POST"
					? .json(201, Fixtures.article(id: "url-saved"))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor, maxRawHTMLBytes: 4)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil)

		XCTAssertEqual(outcome, .savedLinkOnly)
		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertEqual(queuePosts.count, 1)
		let body = TestSupport.jsonObject(try XCTUnwrap(queuePosts.first).body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/post")
		XCTAssertNil(body["rawHtml"], "the over-cap save must fall back to URL-only without rawHtml")
		XCTAssertTrue(
			StubURLProtocol.records(path: "/queue/save-html").isEmpty,
			"must not POST save-html when the captured HTML is over the cap"
		)
	}

	func testGuardsWhenLoggedOut() async throws {
		// A logged-out store must short-circuit before any network call.
		let loggedOut = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let saver = SaveSharedPage(
			store: loggedOut,
			api: makeAPI(store: loggedOut),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x"))
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil)

		XCTAssertEqual(outcome, .notLoggedIn)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted when logged out")
	}

	func testReturnsNoLinkWhenURLMissing() async throws {
		// A share with no extractable URL must neither capture nor hit the network.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x"))
		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)

		let outcome = await saver.run(url: nil, fallbackTitle: "Shared title")

		XCTAssertEqual(outcome, .noLink)
		XCTAssertEqual(captor.capturedURLs, [], "must not capture a page when there is no link")
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted when there is no link")
	}

	func testReturnsNoSaveActionWhenServerOffersNeither() async throws {
		// The queue loaded but advertised neither save action, so there is nothing to do.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured"))
		let searchOnly = """
		{ "name": "search", "href": "/queue", "method": "GET" }
		"""
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], actionsJSON: searchOnly))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil)

		XCTAssertEqual(outcome, .noSaveAction)
		let posts = StubURLProtocol.records.filter { $0.request.httpMethod == "POST" }
		XCTAssertTrue(posts.isEmpty, "no save must be attempted when the server offers no save action")
	}
}
