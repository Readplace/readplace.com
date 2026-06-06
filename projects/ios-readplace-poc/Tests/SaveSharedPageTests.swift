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
		ReadplaceAPI(baseURL: store.baseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
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
		let body = TestSupport.jsonObject(saveHtmlRecords.first!.body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/post")
		XCTAssertEqual(body["rawHtml"] as? String, "<html><body>hi</body></html>")
		XCTAssertEqual(body["title"] as? String, "Captured")

		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertTrue(queuePosts.isEmpty, "must not also POST the URL-only save when save-html succeeds")
	}

	func testDegradesToLinkOnlyAndGuardsWhenLoggedOut() async throws {
		// Degrade: the capture produced no HTML, so the orchestrator saves URL-only.
		let loggedIn = TestSupport.loggedInStore()
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

		let degrade = SaveSharedPage(store: loggedIn, api: makeAPI(store: loggedIn), captor: emptyCaptor)
		let outcome = await degrade.run(url: URL(string: "https://example.com/post")!, fallbackTitle: "Shared title")

		XCTAssertEqual(outcome, .savedLinkOnly)
		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertEqual(queuePosts.count, 1)
		let body = TestSupport.jsonObject(queuePosts.first!.body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/post")
		XCTAssertNil(body["rawHtml"], "the URL-only save must not carry rawHtml")
		XCTAssertTrue(StubURLProtocol.records(path: "/queue/save-html").isEmpty)

		// Guard: a logged-out store must short-circuit before any network call.
		StubURLProtocol.reset()
		let loggedOut = TokenStore(defaults: TestSupport.ephemeralDefaults())
		loggedOut.baseURL = "https://readplace.com"
		let guarded = SaveSharedPage(
			store: loggedOut,
			api: makeAPI(store: loggedOut),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x"))
		)
		let guardOutcome = await guarded.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil)

		XCTAssertEqual(guardOutcome, .notLoggedIn)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted when logged out")
	}
}
