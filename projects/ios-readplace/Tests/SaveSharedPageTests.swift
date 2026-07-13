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

	func testSavesRenderedHTMLViaSaveContent() async throws {
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/queue/save-content":
				return .json(201, Fixtures.article(id: "saved", url: "https://example.com/post"))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .savedWithContent)
		XCTAssertEqual(captor.capturedURLs, [URL(string: "https://example.com/post")!])

		let saveRecords = StubURLProtocol.records(path: "/queue/save-content")
		XCTAssertEqual(saveRecords.count, 1)
		let record = try XCTUnwrap(saveRecords.first)
		XCTAssertEqual(
			record.request.value(forHTTPHeaderField: "X-Readplace-Client"),
			"ios",
			"the share-extension save must carry the iOS client header so the server records onboarding step 2"
		)
		let parts = TestSupport.multipartParts(
			contentType: record.request.value(forHTTPHeaderField: "Content-Type"),
			body: record.body
		)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/post")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "text/html")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Captured")
		let contentPart = try XCTUnwrap(parts.first { $0.name == "content" })
		XCTAssertEqual(contentPart.filename, "content", "the content part needs a filename so the server treats it as a file")
		XCTAssertEqual(contentPart.text, "<html><body>hi</body></html>")

		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertTrue(queuePosts.isEmpty, "must not also POST the URL-only save when save-content succeeds")
	}

	func testRefusesWhenServerRefusesTheSave() async throws {
		// The server refuses the save with a message-only error (e.g. a locked
		// account). The share-save journey — the path the user actually takes from
		// the Share Sheet — must surface it as `.refused` so the shell shows the
		// server's message, not the generic "Save failed."; and the refusal must not
		// fall back to a URL-only save.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/queue/save-content":
				return .json(403, Fixtures.accountLockedError())
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

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
		let emptyCaptor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: nil))
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
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: "Shared title", sharedPdf: nil)

		XCTAssertEqual(outcome, .savedLinkOnly)
		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertEqual(queuePosts.count, 1)
		let body = TestSupport.jsonObject(try XCTUnwrap(queuePosts.first).body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/post")
		XCTAssertNil(body["rawHtml"], "the URL-only save must not carry rawHtml")
		XCTAssertTrue(StubURLProtocol.records(path: "/queue/save-content").isEmpty)
	}

	func testDegradesToLinkOnlyWhenServerRefusesContentWithAFallback() async throws {
		// The orchestrator attempts save-content (no client-side cap), the server
		// refuses the payload with a URL-only fallback action, and the journey
		// follows it — surfacing the server-driven degradation as savedLinkOnly.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue/save-content":
				return .json(422, Fixtures.sirenError(code: "content-too-large", message: "Too big", withSaveArticleFallback: true))
			case "/queue":
				return request.httpMethod == "POST"
					? .json(201, Fixtures.article(id: "url-saved"))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .savedLinkOnly)
		XCTAssertEqual(
			StubURLProtocol.records(path: "/queue/save-content").count, 1,
			"the client attempts save-content and lets the server decide, rather than gating on a client-side cap"
		)
		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertEqual(queuePosts.count, 1)
		let body = TestSupport.jsonObject(try XCTUnwrap(queuePosts.first).body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/post")
		XCTAssertNil(body["rawHtml"], "the fallback save must drop the captured content")
	}

	func testSavesPdfViaSaveContent() async throws {
		// A shared URL the captor resolved to a PDF: the journey fetches the bytes
		// directly and uploads them as application/pdf, instead of degrading to a
		// URL-only crawl the bot-defended origin might block.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: "application/pdf"))
		let pdfBytes = Data("%PDF-1.7\nfake pdf body".utf8)
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/paper.pdf":
				return StubURLProtocol.Stub(status: 200, headers: ["Content-Type": "application/pdf"], body: pdfBytes)
			case "/queue/save-content":
				return .json(201, Fixtures.article(id: "saved", url: "https://example.com/paper.pdf"))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/paper.pdf")!, fallbackTitle: "Paper", sharedPdf: nil)

		XCTAssertEqual(outcome, .savedWithContent)

		let saveRecords = StubURLProtocol.records(path: "/queue/save-content")
		XCTAssertEqual(saveRecords.count, 1)
		let record = try XCTUnwrap(saveRecords.first)
		let parts = TestSupport.multipartParts(
			contentType: record.request.value(forHTTPHeaderField: "Content-Type"),
			body: record.body
		)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/paper.pdf")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "application/pdf")
		let contentPart = try XCTUnwrap(parts.first { $0.name == "content" })
		XCTAssertEqual(contentPart.filename, "content")
		XCTAssertEqual(contentPart.body, pdfBytes, "the fetched PDF bytes must reach the server unaltered")

		let externalRecord = try XCTUnwrap(StubURLProtocol.records(path: "/paper.pdf").first)
		XCTAssertNil(
			externalRecord.request.value(forHTTPHeaderField: "Authorization"),
			"the external PDF fetch must never carry the Readplace bearer token"
		)
	}

	func testSavesShareSheetPdfBytesWithoutRenderingOrRefetching() async throws {
		// The share sheet delivered the PDF itself (Safari's PDF viewer, Files).
		// The journey must upload those bytes directly — no WKWebView render, no
		// refetch of an origin that might block a cookie-less second request.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>never used</html>", title: "never used", mediaType: nil))
		let pdfBytes = Data("%PDF-1.7\nshared pdf body".utf8)
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/queue/save-content":
				return .json(201, Fixtures.article(id: "saved", url: "https://example.com/paper.pdf"))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/paper.pdf")!,
			fallbackTitle: "Paper",
			sharedPdf: { pdfBytes }
		)

		XCTAssertEqual(outcome, .savedWithContent)
		XCTAssertEqual(captor.capturedURLs, [], "delivered bytes must not trigger a WKWebView render")
		XCTAssertTrue(
			StubURLProtocol.records(path: "/paper.pdf").isEmpty,
			"delivered bytes must not be refetched from the origin"
		)

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		let parts = TestSupport.multipartParts(
			contentType: record.request.value(forHTTPHeaderField: "Content-Type"),
			body: record.body
		)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/paper.pdf")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "application/pdf")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Paper")
		let contentPart = try XCTUnwrap(parts.first { $0.name == "content" })
		XCTAssertEqual(contentPart.body, pdfBytes, "the shared PDF bytes must reach the server unaltered")
	}

	func testIgnoresSharedBytesWithoutPdfMagic() async throws {
		// Bytes the share sheet claimed were a PDF but that don't carry the
		// `%PDF-` magic header must not be uploaded; the journey falls back to the
		// normal capture path for the URL.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/queue/save-content":
				return .json(201, Fixtures.article(id: "saved", url: "https://example.com/post"))
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: { Data("not a pdf at all".utf8) }
		)

		XCTAssertEqual(outcome, .savedWithContent)
		XCTAssertEqual(
			captor.capturedURLs, [URL(string: "https://example.com/post")!],
			"junk shared bytes must fall back to the capture path"
		)
		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		let parts = TestSupport.multipartParts(
			contentType: record.request.value(forHTTPHeaderField: "Content-Type"),
			body: record.body
		)
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "text/html", "the junk bytes must never be uploaded as a PDF")
	}

	func testReturnsNoLinkWhenOnlyPdfBytesShared() async throws {
		// A PDF shared with no web link (e.g. straight from the Files app) has no
		// URL to key the article on, so the journey reports .noLink before any
		// capture, network call, or PDF byte load.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil))
		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)

		let outcome = await saver.run(url: nil, fallbackTitle: "Form.pdf", sharedPdf: { () async -> Data? in
			XCTFail("PDF bytes must not be loaded when there is no article URL")
			return nil
		})

		XCTAssertEqual(outcome, .noLink)
		XCTAssertEqual(captor.capturedURLs, [])
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted without an article URL")
	}

	func testPdfFetchFailureDegradesToSaveArticle() async throws {
		// The captor resolved a PDF but the cookie-less external fetch is blocked.
		// The journey must not upload junk — it degrades to a single URL-only save
		// and lets the server's own crawl try the origin.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: "application/pdf"))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return request.httpMethod == "POST"
					? .json(201, Fixtures.article(id: "url-saved"))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/paper.pdf":
				return .json(403, "{}")
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/paper.pdf")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .savedLinkOnly)
		XCTAssertTrue(
			StubURLProtocol.records(path: "/queue/save-content").isEmpty,
			"a failed PDF fetch must not upload content"
		)
		let queuePosts = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
		XCTAssertEqual(queuePosts.count, 1, "the failed fetch degrades to a single URL-only save")
	}

	func testGuardsWhenLoggedOut() async throws {
		// A logged-out store must short-circuit before any network call or PDF
		// byte load.
		let loggedOut = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let saver = SaveSharedPage(
			store: loggedOut,
			api: makeAPI(store: loggedOut),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil))
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: { () async -> Data? in
			XCTFail("PDF bytes must not be loaded when logged out")
			return nil
		})

		XCTAssertEqual(outcome, .notLoggedIn)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted when logged out")
	}

	func testReturnsNoLinkWhenURLMissing() async throws {
		// A share with no extractable URL must neither capture nor hit the network.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil))
		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)

		let outcome = await saver.run(url: nil, fallbackTitle: "Shared title", sharedPdf: nil)

		XCTAssertEqual(outcome, .noLink)
		XCTAssertEqual(captor.capturedURLs, [], "must not capture a page when there is no link")
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted when there is no link")
	}

	func testReturnsNoSaveActionWhenServerOffersNeither() async throws {
		// The queue loaded but advertised neither save action, so there is nothing to do.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
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
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .noSaveAction)
		let posts = StubURLProtocol.records.filter { $0.request.httpMethod == "POST" }
		XCTAssertTrue(posts.isEmpty, "no save must be attempted when the server offers no save action")
	}

	func testFailsWhenQueueResponseIsUndecodable() async throws {
		// The queue replied 200 with the negotiated Siren media type but a body
		// that is not a Siren collection (a JSON array), so the journey surfaces
		// the API's own decode message as .failed — and attempts no save.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, "[]")
			default:
				return .json(404, "{}")
			}
		}

		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .failed("Could not read the server response."))
		let posts = StubURLProtocol.records.filter { $0.request.httpMethod == "POST" }
		XCTAssertTrue(posts.isEmpty, "no save must be attempted when the queue cannot be decoded")
	}

	func testSurfacesTheServerSaveNoticeBeforeTheUploadBegins() async throws {
		// The queue collection carries the server's "don't close this" notice. The
		// journey must hand it to the shell as soon as the list loads — before the
		// capture and upload — so the caption is on screen for the whole phase the
		// user must not interrupt, not only once the bytes are already in flight.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		let notice = "{ \"type\": \"warning\", \"content\": { \"type\": \"text/html\", \"body\": \"Don't close this — it's still saving.\" } }"
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], messagesJSON: notice))
			case "/queue/save-content":
				return .json(201, Fixtures.article(id: "saved", url: "https://example.com/post"))
			default:
				return .json(404, "{}")
			}
		}

		var noticed: [ServerMessage] = []
		var capturedCountWhenNoticed = -1
		var saveCountWhenNoticed = -1
		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onNotice: { messages in
				noticed = messages
				capturedCountWhenNoticed = captor.capturedURLs.count
				saveCountWhenNoticed = StubURLProtocol.records(path: "/queue/save-content").count
			}
		)

		XCTAssertEqual(outcome, .savedWithContent)
		XCTAssertEqual(
			noticed.map(\.plainText), ["Don't close this — it's still saving."],
			"the server's save notice reaches the shell verbatim"
		)
		XCTAssertEqual(
			capturedCountWhenNoticed, 0,
			"the notice fires before the WKWebView capture, so the caption covers the slow capture phase too"
		)
		XCTAssertEqual(
			saveCountWhenNoticed, 0,
			"the notice fires before the upload, so the caption is up for the whole slow phase"
		)
		XCTAssertEqual(captor.capturedURLs.count, 1, "the capture still runs after the notice")
		XCTAssertEqual(StubURLProtocol.records(path: "/queue/save-content").count, 1)
	}

	func testFiresTheNoticeCallbackEmptyWhenTheServerOffersNone() async throws {
		// A server that emits no collection notice still drives the callback once — with
		// no messages — so the shell can leave the caption hidden rather than assume it.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			case "/queue/save-content":
				return .json(201, Fixtures.article(id: "saved", url: "https://example.com/post"))
			default:
				return .json(404, "{}")
			}
		}

		var callbackCount = 0
		var lastMessages: [ServerMessage] = []
		let saver = SaveSharedPage(store: store, api: makeAPI(store: store), captor: captor)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onNotice: { messages in
				callbackCount += 1
				lastMessages = messages
			}
		)

		XCTAssertEqual(outcome, .savedWithContent)
		XCTAssertEqual(callbackCount, 1, "the callback fires exactly once per save")
		XCTAssertTrue(lastMessages.isEmpty, "with no server notice, the callback carries no messages")
	}
}
