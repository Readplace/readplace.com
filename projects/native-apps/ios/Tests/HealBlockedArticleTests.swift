import XCTest
@testable import Readplace

@MainActor
final class HealBlockedArticleTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private let blockedURL = URL(string: "https://example.com/post")!

	private func makeHealer(store: TokenStore, captor: HTMLCapturing) -> HealBlockedArticle {
		HealBlockedArticle(
			api: ReadplaceAPI(
				baseURL: AppConfig.serverBaseURL,
				store: store,
				sessionConfiguration: TestSupport.stubbedConfiguration()
			),
			captor: captor
		)
	}

	private func serveReadlistAndSaveContent(
		actionsJSON: String = Fixtures.collectionActions,
		saveContentStub: @escaping () -> StubURLProtocol.Stub = { .json(201, Fixtures.article(id: "healed")) }
	) {
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], actionsJSON: actionsJSON))
			case "/queue/save-content":
				return saveContentStub()
			default:
				return .json(404, "{}")
			}
		}
	}

	func testUploadsTheOnDeviceCaptureThroughTheAdvertisedSaveContentAction() async throws {
		let captor = FakeHTMLCaptor(
			page: CapturedPage(rawHtml: "<html><body>the page the crawler was blocked from</body></html>", title: "Captured", mediaType: "text/html")
		)
		serveReadlistAndSaveContent()

		let outcome = try await makeHealer(store: TestSupport.loggedInStore(access: "access-1"), captor: captor).run(url: blockedURL)

		XCTAssertEqual(outcome, .healed)
		XCTAssertNil(outcome.failureText, "a landed heal leaves nothing to tell the user about")
		XCTAssertEqual(
			captor.capturedURLs, [blockedURL],
			"the heal renders the blocked origin itself, on the user's own connection"
		)

		let uploads = StubURLProtocol.records(path: "/queue/save-content")
		XCTAssertEqual(uploads.count, 1, "one explicit user action uploads exactly once")
		let upload = try XCTUnwrap(uploads.first)
		XCTAssertEqual(upload.request.httpMethod, "POST", "the upload follows the server-declared method")
		XCTAssertEqual(
			upload.request.value(forHTTPHeaderField: "Authorization"), "Bearer access-1",
			"the foreground upload carries the bearer send() attaches, so an expired token is refreshed rather than dropped"
		)
		XCTAssertEqual(
			upload.request.value(forHTTPHeaderField: "Accept"), AppConfig.sirenMediaType,
			"the server answers save-content with 406 for a client that does not accept Siren"
		)
		XCTAssertEqual(upload.request.value(forHTTPHeaderField: "X-Readplace-Client"), "ios")

		let parts = TestSupport.multipartParts(
			contentType: upload.request.value(forHTTPHeaderField: "Content-Type"),
			body: upload.body
		)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/post")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "text/html")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Captured")
		let content = try XCTUnwrap(parts.first { $0.name == "content" })
		XCTAssertEqual(content.filename, "content", "the content part needs a filename so the server treats it as a file")
		XCTAssertEqual(content.text, "<html><body>the page the crawler was blocked from</body></html>")
	}

	func testSendsNoTitlePartWhenTheRenderNamedThePageNothing() async throws {
		serveReadlistAndSaveContent()

		let outcome = try await makeHealer(
			store: TestSupport.loggedInStore(),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: nil, mediaType: "text/html"))
		).run(url: blockedURL)

		XCTAssertEqual(outcome, .healed)
		let upload = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		let parts = TestSupport.multipartParts(
			contentType: upload.request.value(forHTTPHeaderField: "Content-Type"),
			body: upload.body
		)
		XCTAssertEqual(
			parts.compactMap(\.name), ["url", "mediaType", "content"],
			"an untitled render sends no title part rather than an empty one"
		)
	}

	func testUploadsNothingWhenTheCaptureProducedNoHtml() async throws {
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: "application/pdf"))

		let outcome = try await makeHealer(store: TestSupport.loggedInStore(), captor: captor).run(url: blockedURL)

		XCTAssertEqual(outcome, .captureWasEmpty)
		XCTAssertTrue(
			StubURLProtocol.records.isEmpty,
			"a capture with nothing in it must not reach the network at all"
		)
	}

	func testUploadsNothingWhenTheServerAdvertisesNoContentAction() async throws {
		let saveArticleOnly = """
		{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }
		"""
		serveReadlistAndSaveContent(actionsJSON: saveArticleOnly)

		let outcome = try await makeHealer(
			store: TestSupport.loggedInStore(),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: nil, mediaType: "text/html"))
		).run(url: blockedURL)

		XCTAssertEqual(outcome, .noSaveContentAction)
		XCTAssertEqual(
			outcome.failureText, "The server offered no way to save the captured page.",
			"a heal the server offers no home for is reported, not swallowed"
		)
		XCTAssertTrue(
			StubURLProtocol.records.filter { $0.request.httpMethod == "POST" }.isEmpty,
			"the client never constructs an href the server did not advertise"
		)
	}

	func testSurfacesTheServersRefusalToTheCaller() async throws {
		serveReadlistAndSaveContent(saveContentStub: { .json(403, Fixtures.accountLockedError()) })

		do {
			_ = try await makeHealer(
				store: TestSupport.loggedInStore(),
				captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: nil, mediaType: "text/html"))
			).run(url: blockedURL)
			XCTFail("expected the server's refusal to surface")
		} catch let APIError.refused(messages) {
			XCTAssertTrue(
				messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false,
				"the refusal carries the server's message so the caller renders it verbatim"
			)
		}
	}
}
