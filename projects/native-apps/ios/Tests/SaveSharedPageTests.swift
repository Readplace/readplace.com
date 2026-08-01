import XCTest
@testable import Readplace

/// End-to-end coverage of the share-save journey: `SaveSharedPage.run` drives the
/// real list → save → hand-off decision tree through the production API and token
/// types, with the page capture faked by `FakeHTMLCaptor`, the network by
/// `StubURLProtocol`, and the background session by `FakeBackgroundUploads`.
@MainActor
final class SaveSharedPageTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeAPI(store: TokenStore) -> ReadplaceAPI {
		ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
	}

	/// Every save shares the same shape: the queue, and a URL-only save that
	/// answers 201. Anything else — including a content upload, which belongs on
	/// the fake scheduler, never this stub — lands in the 404 arm and fails loudly.
	private func serveQueueAndSave(messagesJSON: String? = nil, extra: @escaping (URLRequest) -> StubURLProtocol.Stub? = { _ in nil }) {
		StubURLProtocol.setHandler { request, _ in
			if let stub = extra(request) { return stub }
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return request.httpMethod == "POST"
					? .json(201, Fixtures.article(id: "url-saved"))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], messagesJSON: messagesJSON))
			default:
				return .json(404, "{}")
			}
		}
	}

	private func makeSaver(
		store: TokenStore,
		captor: HTMLCapturing,
		uploads: BackgroundUploading,
		container: URL,
		captureGrace: TimeInterval = 4
	) -> SaveSharedPage {
		SaveSharedPage(
			store: store,
			api: makeAPI(store: store),
			captor: captor,
			staging: UploadStaging(containerURL: container),
			uploads: uploads,
			captureGrace: captureGrace
		)
	}

	private func urlOnlyPosts() -> [StubURLProtocol.Record] {
		StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
	}

	func testSavesTheLinkFirstThenHandsTheCaptureToTheBackgroundSession() async throws {
		let store = TestSupport.loggedInStore(access: "access-1")
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		let uploads = FakeBackgroundUploads()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, uploads: uploads, container: TestSupport.temporaryContainer())
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(captor.capturedURLs, [URL(string: "https://example.com/post")!])

		let saveRecords = urlOnlyPosts()
		XCTAssertEqual(saveRecords.count, 1, "the link is saved with one URL-only POST")
		let saved = try XCTUnwrap(saveRecords.first)
		XCTAssertEqual(TestSupport.jsonObject(saved.body)["url"] as? String, "https://example.com/post")
		XCTAssertEqual(
			saved.request.value(forHTTPHeaderField: "X-Readplace-Client"), "ios",
			"the share-extension save must carry the iOS client header so the server records onboarding step 2"
		)
		XCTAssertTrue(
			StubURLProtocol.records(path: "/queue/save-content").isEmpty,
			"the content must never ride the foreground request the sheet waits on"
		)

		let handoff = try XCTUnwrap(uploads.handoffs.first)
		XCTAssertEqual(uploads.handoffs.count, 1)
		XCTAssertEqual(handoff.request.url?.path, "/queue/save-content", "the upload follows the server-declared href")
		XCTAssertEqual(handoff.request.httpMethod, "POST")
		XCTAssertEqual(handoff.request.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(
			handoff.request.value(forHTTPHeaderField: "Accept"), AppConfig.sirenMediaType,
			"the server answers save-content with 406 for a client that does not accept Siren, and nothing retries this upload"
		)
		XCTAssertEqual(handoff.request.value(forHTTPHeaderField: "X-Readplace-Client"), "ios")
		XCTAssertEqual(
			handoff.request.value(forHTTPHeaderField: "X-Readplace-Save-Continuity"), "background",
			"the upload tells the server the save survives the share sheet"
		)

		let parts = TestSupport.multipartParts(
			contentType: handoff.request.value(forHTTPHeaderField: "Content-Type"),
			body: try Data(contentsOf: handoff.file)
		)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/post")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "text/html")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Captured")
		let contentPart = try XCTUnwrap(parts.first { $0.name == "content" })
		XCTAssertEqual(contentPart.filename, "content", "the content part needs a filename so the server treats it as a file")
		XCTAssertEqual(contentPart.text, "<html><body>hi</body></html>")
	}

	func testSpeaksTheServersConfirmationFromTheSaveResponse() async throws {
		// The 201 carries what to tell the reader; the journey hands it to the
		// sheet at the moment it paints, and the outcome carries the same words —
		// so the copy changes server-side, with no App Store release.
		let store = TestSupport.loggedInStore()
		let emptyCaptor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: nil))
		let savedBody = """
		{
			"class": ["article"],
			"properties": {
				"id": "url-saved",
				"url": "https://example.com/post",
				"status": "unread",
				"savedAt": "2026-05-30T10:00:00.000Z",
				"messages": [
					{ "type": "success", "content": { "type": "text/html", "body": "Article saved" } },
					{ "type": "success", "content": { "type": "text/html", "body": "Saved to your reading list" } },
					{ "type": "success", "content": { "type": "application/pdf", "body": "%PDF-" } }
				]
			}
		}
		"""
		serveQueueAndSave(extra: { request in
			guard request.url?.path == "/queue", request.httpMethod == "POST" else { return nil }
			return .json(201, savedBody)
		})

		var reported: [ServerMessage] = []
		let saver = makeSaver(
			store: store,
			captor: emptyCaptor,
			uploads: FakeBackgroundUploads(),
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onSaved: { reported = $0 }
		)

		XCTAssertEqual(reported.map(\.plainText), ["Article saved", "Saved to your reading list"],
			"the sheet is handed the renderable confirmation, and only the renderable")
		XCTAssertEqual(outcome, .saved(reported))
	}

	func testReportsSavedBeforeTheCaptureIsHandedOff() async throws {
		// The whole point of the reshape: the sheet is told "Saved" the moment the
		// link lands, with the capture still running behind it.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil), delay: 0.2)
		let uploads = FakeBackgroundUploads()
		serveQueueAndSave()

		var savePostsWhenReported = -1
		var handoffsWhenReported = -1
		let saver = makeSaver(store: store, captor: captor, uploads: uploads, container: TestSupport.temporaryContainer())
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onSaved: { _ in
				savePostsWhenReported = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }.count
				handoffsWhenReported = uploads.handoffs.count
			}
		)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(savePostsWhenReported, 1, "the link is already on the server when the sheet is told 'Saved'")
		XCTAssertEqual(handoffsWhenReported, 0, "the sheet does not wait for the capture before saying 'Saved'")
		XCTAssertEqual(uploads.handoffs.count, 1, "the capture still reaches the background session afterwards")
	}

	func testAbandonsACaptureThatOutlastsTheGraceWindow() async throws {
		// The render ran long. The link is already saved and the server's crawl
		// covers the content, so the journey stops waiting and stages nothing —
		// rather than holding the share sheet open for a render nobody is watching.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>slow</html>", title: "Slow", mediaType: nil), delay: 5)
		let uploads = FakeBackgroundUploads()
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, uploads: uploads, container: container, captureGrace: 0.05)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]), "losing the capture never loses the save")
		XCTAssertEqual(uploads.handoffs.count, 0, "a capture past the window is abandoned, never retried")
		XCTAssertEqual(urlOnlyPosts().count, 1, "the link was saved exactly once, with no retry of any kind")
	}

	func testUploadsTheSharedPdfBytesWithoutRenderingOrRefetching() async throws {
		// The share sheet delivered the PDF itself (Safari's PDF viewer, Files).
		// The journey must upload those bytes directly — no WKWebView render, no
		// refetch of an origin that might block a cookie-less second request.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>never used</html>", title: "never used", mediaType: nil))
		let uploads = FakeBackgroundUploads()
		let pdfBytes = Data("%PDF-1.7\nshared pdf body".utf8)
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, uploads: uploads, container: TestSupport.temporaryContainer())
		let outcome = await saver.run(
			url: URL(string: "https://example.com/paper.pdf")!,
			fallbackTitle: "Paper",
			sharedPdf: { pdfBytes }
		)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(captor.capturedURLs, [], "delivered bytes must not trigger a WKWebView render")
		XCTAssertTrue(
			StubURLProtocol.records(path: "/paper.pdf").isEmpty,
			"delivered bytes must not be refetched from the origin"
		)

		let handoff = try XCTUnwrap(uploads.handoffs.first)
		let parts = TestSupport.multipartParts(
			contentType: handoff.request.value(forHTTPHeaderField: "Content-Type"),
			body: try Data(contentsOf: handoff.file)
		)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/paper.pdf")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "application/pdf")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Paper")
		XCTAssertEqual(parts.first { $0.name == "content" }?.body, pdfBytes, "the shared PDF bytes must reach the server unaltered")
	}

	func testFetchesAndUploadsAPdfTheCaptorOnlyDetected() async throws {
		// A shared URL the captor resolved to a PDF: the journey fetches the bytes
		// directly and uploads them as application/pdf, instead of leaving the
		// server's crawl to a bot-defended origin it may not get past.
		let store = TestSupport.loggedInStore(access: "secret-access")
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: "application/pdf"))
		let uploads = FakeBackgroundUploads()
		let pdfBytes = Data("%PDF-1.7\nfake pdf body".utf8)
		serveQueueAndSave { request in
			request.url?.path == "/paper.pdf"
				? StubURLProtocol.Stub(status: 200, headers: ["Content-Type": "application/pdf"], body: pdfBytes)
				: nil
		}

		let saver = makeSaver(store: store, captor: captor, uploads: uploads, container: TestSupport.temporaryContainer())
		let outcome = await saver.run(url: URL(string: "https://example.com/paper.pdf")!, fallbackTitle: "Paper", sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		let handoff = try XCTUnwrap(uploads.handoffs.first)
		let parts = TestSupport.multipartParts(
			contentType: handoff.request.value(forHTTPHeaderField: "Content-Type"),
			body: try Data(contentsOf: handoff.file)
		)
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "application/pdf")
		XCTAssertEqual(parts.first { $0.name == "content" }?.body, pdfBytes, "the fetched PDF bytes must reach the server unaltered")

		let externalRecord = try XCTUnwrap(StubURLProtocol.records(path: "/paper.pdf").first)
		XCTAssertNil(
			externalRecord.request.value(forHTTPHeaderField: "Authorization"),
			"the external PDF fetch must never carry the Readplace bearer token"
		)
	}

	func testIgnoresSharedBytesWithoutPdfMagic() async throws {
		// Bytes the share sheet claimed were a PDF but that don't carry the `%PDF-`
		// magic header must not be uploaded; the journey falls back to the normal
		// capture path for the URL.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		let uploads = FakeBackgroundUploads()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, uploads: uploads, container: TestSupport.temporaryContainer())
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: { Data("not a pdf at all".utf8) }
		)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(
			captor.capturedURLs, [URL(string: "https://example.com/post")!],
			"junk shared bytes must fall back to the capture path"
		)
		let handoff = try XCTUnwrap(uploads.handoffs.first)
		let parts = TestSupport.multipartParts(
			contentType: handoff.request.value(forHTTPHeaderField: "Content-Type"),
			body: try Data(contentsOf: handoff.file)
		)
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "text/html", "the junk bytes must never be uploaded as a PDF")
	}

	func testUploadsNothingWhenTheCaptureIsEmpty() async throws {
		// The capture produced no HTML, so there is nothing to enrich with — the
		// link is saved and the server's crawl is left to it.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
		serveQueueAndSave()

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: nil)),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: "Shared title", sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(urlOnlyPosts().count, 1)
		XCTAssertEqual(uploads.handoffs.count, 0, "an empty capture is not an upload")
	}

	func testUploadsNothingWhenThePdfFetchIsBlocked() async throws {
		// The captor resolved a PDF but the cookie-less external fetch is blocked.
		// The journey must not upload junk — the link stands on its own.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
		serveQueueAndSave { request in request.url?.path == "/paper.pdf" ? .json(403, "{}") : nil }

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: "application/pdf")),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/paper.pdf")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(uploads.handoffs.count, 0, "a failed PDF fetch must not upload content")
		XCTAssertEqual(urlOnlyPosts().count, 1)
	}

	func testUploadsNothingWhenTheServerAdvertisesNoContentAction() async throws {
		// The server offers the URL-only save but no `save-content`. There is
		// nowhere to send the capture, so it is never even waited for.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
		let saveArticleOnly = """
		{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }
		"""
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return request.httpMethod == "POST"
					? .json(201, Fixtures.article(id: "url-saved"))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], actionsJSON: saveArticleOnly))
			default:
				return .json(404, "{}")
			}
		}

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil), delay: 5),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(uploads.handoffs.count, 0)
	}

	func testRefusesWhenTheServerRefusesTheSave() async throws {
		// The server refuses the save with a message-only error (e.g. a locked
		// account). The journey must surface it as `.refused` so the shell shows the
		// server's message, and must upload nothing for an article that never landed.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return request.httpMethod == "POST"
					? .json(403, Fixtures.accountLockedError())
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		guard case let .refused(messages) = outcome else {
			return XCTFail("expected .refused, got \(outcome)")
		}
		XCTAssertEqual(messages.first?.content.type, "text/html")
		XCTAssertTrue(
			messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false,
			"the refusal must carry the server's contact message verbatim"
		)
		XCTAssertEqual(uploads.handoffs.count, 0, "a refused save has no article to enrich")
	}

	func testGuardsWhenLoggedOut() async throws {
		// A logged-out store must short-circuit before any network call or PDF
		// byte load.
		let loggedOut = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let uploads = FakeBackgroundUploads()
		let saver = makeSaver(
			store: loggedOut,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil)),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)

		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: { () async -> Data? in
			XCTFail("PDF bytes must not be loaded when logged out")
			return nil
		})

		XCTAssertEqual(outcome, .notLoggedIn)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted when logged out")
		XCTAssertEqual(uploads.handoffs.count, 0)
	}

	func testReturnsNoLinkWhenOnlyPdfBytesShared() async throws {
		// A PDF shared with no web link (e.g. straight from the Files app) has no
		// URL to key the article on, so the journey reports .noLink before any
		// capture, network call, or PDF byte load.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil))
		let saver = makeSaver(store: store, captor: captor, uploads: FakeBackgroundUploads(), container: TestSupport.temporaryContainer())

		let outcome = await saver.run(url: nil, fallbackTitle: "Form.pdf", sharedPdf: { () async -> Data? in
			XCTFail("PDF bytes must not be loaded when there is no article URL")
			return nil
		})

		XCTAssertEqual(outcome, .noLink)
		XCTAssertEqual(captor.capturedURLs, [])
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted without an article URL")
	}

	func testReturnsNoSaveActionWhenServerOffersNoUrlOnlySave() async throws {
		// The queue loaded but advertised no `save-article`, so there is no link to
		// save and nothing to enrich.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
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

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .noSaveAction)
		XCTAssertTrue(
			StubURLProtocol.records.filter { $0.request.httpMethod == "POST" }.isEmpty,
			"no save must be attempted when the server offers no save action"
		)
		XCTAssertEqual(uploads.handoffs.count, 0)
	}

	func testFailsWhenQueueResponseIsUndecodable() async throws {
		// The queue replied 200 with the negotiated Siren media type but a body
		// that is not a Siren collection (a JSON array), so the journey surfaces
		// the API's own decode message as .failed — and attempts no save.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
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

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .failed("Could not read the server response."))
		XCTAssertEqual(uploads.handoffs.count, 0)
	}

	func testFailsWithAGenericMessageWhenTheTransportErrorDescribesNothing() async throws {
		// A transport failure the client cannot read a message out of still has to
		// say something the user can act on, rather than showing an empty card.
		struct WordlessTransportFailure: Error {}
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
		StubURLProtocol.setHandler { _, _ in throw WordlessTransportFailure() }

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .failed("Save failed."))
		XCTAssertEqual(uploads.handoffs.count, 0)
	}

	func testSurfacesTheServerSaveNoticeAsSoonAsTheListLoads() async throws {
		// The queue collection carries the server's save notice. The journey must
		// hand it to the shell as soon as the list loads — before the save lands —
		// so the caption is on screen for the whole phase it describes.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
		let notice = "{ \"type\": \"warning\", \"content\": { \"type\": \"text/html\", \"body\": \"Don't close this — it's still saving.\" } }"
		serveQueueAndSave(messagesJSON: notice)

		var noticed: [ServerMessage] = []
		var savePostsWhenNoticed = -1
		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			uploads: uploads,
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onNotice: { messages in
				noticed = messages
				savePostsWhenNoticed = StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }.count
			}
		)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(
			noticed.map(\.plainText), ["Don't close this — it's still saving."],
			"the server's save notice reaches the shell verbatim"
		)
		XCTAssertEqual(savePostsWhenNoticed, 0, "the notice is up before the save it describes")
	}

	func testFiresTheNoticeCallbackEmptyWhenTheServerOffersNone() async throws {
		// A server that emits no collection notice still drives the callback once — with
		// no messages — so the shell can leave the caption hidden rather than assume it.
		let store = TestSupport.loggedInStore()
		serveQueueAndSave()

		var callbackCount = 0
		var lastMessages: [ServerMessage] = []
		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			uploads: FakeBackgroundUploads(),
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onNotice: { messages in
				callbackCount += 1
				lastMessages = messages
			}
		)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(callbackCount, 1, "the callback fires exactly once per save")
		XCTAssertTrue(lastMessages.isEmpty, "with no server notice, the callback carries no messages")
	}

	func testStagesNothingWithoutASharedContainer() async throws {
		// A build whose App Group container cannot be resolved still saves the link;
		// only the enrichment upload is lost.
		let store = TestSupport.loggedInStore()
		let uploads = FakeBackgroundUploads()
		serveQueueAndSave()

		let saver = SaveSharedPage(
			store: store,
			api: makeAPI(store: store),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			staging: nil,
			uploads: uploads
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(urlOnlyPosts().count, 1)
		XCTAssertEqual(uploads.handoffs.count, 0)
	}
}
