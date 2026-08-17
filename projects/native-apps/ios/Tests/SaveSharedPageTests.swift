import XCTest
@testable import Readplace

/// End-to-end coverage of the share-save journey: `SaveSharedPage.run` drives the
/// real list → save → queue decision tree through the production API, token and
/// upload-queue types, with the page capture faked by `FakeHTMLCaptor` and the
/// network by `StubURLProtocol`.
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
	/// answers 201. Anything else — including a content upload, which this journey
	/// never makes — lands in the 404 arm and fails loudly.
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
		container: URL,
		stillSavingAfter: TimeInterval = 4
	) -> SaveSharedPage {
		SaveSharedPage(
			store: store,
			api: makeAPI(store: store),
			captor: captor,
			jobs: UploadJobStore(containerURL: container),
			stillSavingAfter: stillSavingAfter
		)
	}

	private nonisolated func urlOnlyPosts() -> [StubURLProtocol.Record] {
		StubURLProtocol.records(path: "/queue").filter { $0.request.httpMethod == "POST" }
	}

	private nonisolated func queuedJobs(in container: URL) -> [UploadJob] {
		UploadJobStore(containerURL: container).loadAll(now: .distantFuture)
	}

	private nonisolated func assertUploadedNothing(file: StaticString = #filePath, line: UInt = #line) {
		let uploads = StubURLProtocol.records.filter {
			$0.request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/") == true
		}
		XCTAssertEqual(
			uploads.count, 0,
			"the extension stages content locally; the app is what uploads it",
			file: file,
			line: line
		)
	}

	private func stagedParts(of job: UploadJob, in container: URL) throws -> [MultipartPart] {
		guard case .ready(let contentType) = job.state else {
			XCTFail("expected a ready job, got \(job.state)")
			return []
		}
		return TestSupport.multipartParts(
			contentType: contentType,
			body: try Data(contentsOf: UploadJobStore(containerURL: container).bytesURL(for: job))
		)
	}

	func testSavesTheLinkFirstThenLeavesTheCaptureReadyForTheApp() async throws {
		let store = TestSupport.loggedInStore(access: "access-1")
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, container: container)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(captor.capturedURLs, [URL(string: "https://example.com/post")!])

		let saveRecords = urlOnlyPosts()
		XCTAssertEqual(saveRecords.count, 1, "the link is saved with one URL-only POST")
		let saved = try XCTUnwrap(saveRecords.first)
		XCTAssertEqual(TestSupport.jsonObject(saved.body)["url"] as? String, "https://example.com/post")
		XCTAssertEqual(
			saved.request.value(forHTTPHeaderField: "X-Readplace-Client"), "ios",
			"the share-extension save must carry the iOS client header so the server records onboarding step 2"
		)
		assertUploadedNothing()

		let job = try XCTUnwrap(queuedJobs(in: container).first)
		XCTAssertEqual(queuedJobs(in: container).count, 1)
		XCTAssertEqual(job.url, "https://example.com/post", "the app keys the upload on the link the reader saved")
		let parts = try stagedParts(of: job, in: container)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/post")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "text/html")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Captured")
		let contentPart = try XCTUnwrap(parts.first { $0.name == "content" })
		XCTAssertEqual(contentPart.filename, "content", "the content part needs a filename so the server treats it as a file")
		XCTAssertEqual(contentPart.text, "<html><body>hi</body></html>")
	}

	func testQueuesTheJobBeforeItReportsTheLinkSaved() async throws {
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil), delay: 0.2)
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		var statesWhenReported: [UploadJob.State] = []
		let saver = makeSaver(store: store, captor: captor, container: container)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onSaved: { _ in statesWhenReported = self.queuedJobs(in: container).map(\.state) }
		)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(
			statesWhenReported, [.capturePending(detectedMediaType: nil)],
			"the job is on disk, and still owed a capture, at the moment the sheet is told the link is saved"
		)
		assertUploadedNothing()
	}

	func testMarksTheJobReadyOnceTheCaptureIsStaged() async throws {
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil))
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, container: container)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		let job = try XCTUnwrap(queuedJobs(in: container).first)
		XCTAssertEqual(try stagedParts(of: job, in: container).first { $0.name == "content" }?.text, "<html>hi</html>")
		assertUploadedNothing()
	}

	func testReportsTheLinkSavedBeforeTheContentIsStaged() async throws {
		// The sheet is told "Saved" the moment the link lands, with the capture
		// still running behind it.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil), delay: 0.2)
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		var savePostsWhenReported = -1
		var readyWhenReported = true
		let saver = makeSaver(store: store, captor: captor, container: container)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onSaved: { _ in
				savePostsWhenReported = self.urlOnlyPosts().count
				readyWhenReported = self.queuedJobs(in: container).contains { $0.state == .ready(contentType: "text/html") }
			}
		)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(savePostsWhenReported, 1, "the link is already on the server when the sheet is told 'Saved'")
		XCTAssertFalse(readyWhenReported, "the sheet does not wait for the capture before saying 'Saved'")
		let job = try XCTUnwrap(queuedJobs(in: container).first)
		XCTAssertEqual(try stagedParts(of: job, in: container).first { $0.name == "content" }?.text, "<html>hi</html>")
		assertUploadedNothing()
	}

	func testWaitsForACaptureThatOutlastsTheStillSavingThreshold() async throws {
		// The render ran past the point the sheet starts saying so. The journey
		// keeps waiting — the captor's own timeout is the only bound — so the
		// content is staged rather than abandoned.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>slow</html>", title: "Slow", mediaType: nil), delay: 0.3)
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, container: container, stillSavingAfter: 0.05)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		let job = try XCTUnwrap(queuedJobs(in: container).first)
		XCTAssertEqual(try stagedParts(of: job, in: container).first { $0.name == "content" }?.text, "<html>slow</html>")
		XCTAssertEqual(urlOnlyPosts().count, 1, "the link was saved exactly once, with no retry of any kind")
		assertUploadedNothing()
	}

	func testSignalsStillSavingWhenTheJourneyOutlastsItsThreshold() async throws {
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>slow</html>", title: "Slow", mediaType: nil), delay: 0.3)
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		var stillSaving = 0
		let saver = makeSaver(store: store, captor: captor, container: container, stillSavingAfter: 0.05)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onStillSaving: { stillSaving += 1 }
		)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(stillSaving, 1, "the reader is told the sheet is still working, once")
		assertUploadedNothing()
	}

	func testSaysNothingAboutStillSavingWhenTheJourneySettlesFirst() async throws {
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil))
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		var stillSaving = 0
		let saver = makeSaver(store: store, captor: captor, container: container, stillSavingAfter: 30)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onStillSaving: { stillSaving += 1 }
		)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(stillSaving, 0, "a save that settles inside the threshold never says it is running long")
		assertUploadedNothing()
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
		let saver = makeSaver(store: store, captor: emptyCaptor, container: TestSupport.temporaryContainer())
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onSaved: { reported = $0 }
		)

		XCTAssertEqual(reported.map(\.plainText), ["Article saved", "Saved to your reading list"],
			"the sheet is handed the renderable confirmation, and only the renderable")
		XCTAssertEqual(outcome, .savedAwaitingUpload(reported))
		assertUploadedNothing()
	}

	func testStagesTheSharedPdfBytesWithoutRenderingOrRefetching() async throws {
		// The share sheet delivered the PDF itself (Safari's PDF viewer, Files).
		// The journey must stage those bytes directly — no WKWebView render, no
		// refetch of an origin that might block a cookie-less second request.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>never used</html>", title: "never used", mediaType: nil))
		let container = TestSupport.temporaryContainer()
		let pdfBytes = Data("%PDF-1.7\nshared pdf body".utf8)
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, container: container)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/paper.pdf")!,
			fallbackTitle: "Paper",
			sharedPdf: { pdfBytes }
		)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(captor.capturedURLs, [], "delivered bytes must not trigger a WKWebView render")
		XCTAssertTrue(
			StubURLProtocol.records(path: "/paper.pdf").isEmpty,
			"delivered bytes must not be refetched from the origin"
		)

		let job = try XCTUnwrap(queuedJobs(in: container).first)
		let parts = try stagedParts(of: job, in: container)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/paper.pdf")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "application/pdf")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Paper")
		XCTAssertEqual(parts.first { $0.name == "content" }?.body, pdfBytes, "the shared PDF bytes must reach the app unaltered")
		assertUploadedNothing()
	}

	func testLeavesThePdfTheCaptorOnlyDetectedForTheAppToFetch() async throws {
		// A shared URL the captor resolved to a PDF: the extension has no bytes to
		// stage, so it hands the app the media type and lets the app — which is not
		// running under the share sheet's memory budget — fetch them.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: "application/pdf"))
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, container: container)
		let outcome = await saver.run(url: URL(string: "https://example.com/paper.pdf")!, fallbackTitle: "Paper", sharedPdf: nil)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(
			queuedJobs(in: container).map(\.state), [.capturePending(detectedMediaType: "application/pdf")],
			"the app is told what the captor learned, so it does not have to re-detect it"
		)
		XCTAssertTrue(
			StubURLProtocol.records(path: "/paper.pdf").isEmpty,
			"the extension must not spend its memory budget fetching the PDF"
		)
		assertUploadedNothing()
	}

	func testIgnoresSharedBytesWithoutPdfMagic() async throws {
		// Bytes the share sheet claimed were a PDF but that don't carry the `%PDF-`
		// magic header must not be staged; the journey falls back to the normal
		// capture path for the URL.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html><body>hi</body></html>", title: "Captured", mediaType: nil))
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		let saver = makeSaver(store: store, captor: captor, container: container)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: { Data("not a pdf at all".utf8) }
		)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(
			captor.capturedURLs, [URL(string: "https://example.com/post")!],
			"junk shared bytes must fall back to the capture path"
		)
		let job = try XCTUnwrap(queuedJobs(in: container).first)
		XCTAssertEqual(
			try stagedParts(of: job, in: container).first { $0.name == "mediaType" }?.text, "text/html",
			"the junk bytes must never be staged as a PDF"
		)
		assertUploadedNothing()
	}

	func testLeavesTheJobPendingWhenTheCaptureIsEmpty() async throws {
		// The capture produced no HTML, so there is nothing to stage — the job
		// stays as it was admitted, for the app to capture on device.
		let store = TestSupport.loggedInStore()
		let container = TestSupport.temporaryContainer()
		serveQueueAndSave()

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: nil)),
			container: container
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: "Shared title", sharedPdf: nil)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(urlOnlyPosts().count, 1)
		XCTAssertEqual(queuedJobs(in: container).map(\.state), [.capturePending(detectedMediaType: nil)])
		assertUploadedNothing()
	}

	func testQueuesNothingWhenTheServerAdvertisesNoContentAction() async throws {
		// The server offers the URL-only save but no `save-content`. There is
		// nowhere to send the capture, so nothing is queued for the app.
		let store = TestSupport.loggedInStore()
		let container = TestSupport.temporaryContainer()
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
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			container: container
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(queuedJobs(in: container), [])
		assertUploadedNothing()
	}

	func testQueuesNothingWithoutASharedContainer() async throws {
		// A build whose App Group container cannot be resolved still saves the link;
		// only the enrichment upload is lost.
		let store = TestSupport.loggedInStore()
		serveQueueAndSave()

		let saver = SaveSharedPage(
			store: store,
			api: makeAPI(store: store),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			jobs: nil
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .saved([]))
		XCTAssertEqual(urlOnlyPosts().count, 1)
		assertUploadedNothing()
	}

	func testRefusesWhenTheServerRefusesTheSave() async throws {
		// The server refuses the save with a message-only error (e.g. a locked
		// account). The journey must surface it as `.refused` so the shell shows the
		// server's message, and must queue nothing for an article that never landed.
		let store = TestSupport.loggedInStore()
		let container = TestSupport.temporaryContainer()
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
			container: container
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
		XCTAssertEqual(queuedJobs(in: container), [], "a refused save has no article to enrich")
		assertUploadedNothing()
	}

	func testGuardsWhenLoggedOut() async throws {
		// A logged-out store must short-circuit before any network call or PDF
		// byte load.
		let loggedOut = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let container = TestSupport.temporaryContainer()
		let saver = makeSaver(
			store: loggedOut,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil)),
			container: container
		)

		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: { () async -> Data? in
			XCTFail("PDF bytes must not be loaded when logged out")
			return nil
		})

		XCTAssertEqual(outcome, .notLoggedIn)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted when logged out")
		XCTAssertEqual(queuedJobs(in: container), [])
		assertUploadedNothing()
	}

	func testReturnsNoLinkWhenOnlyPdfBytesShared() async throws {
		// A PDF shared with no web link (e.g. straight from the Files app) has no
		// URL to key the article on, so the journey reports .noLink before any
		// capture, network call, or PDF byte load.
		let store = TestSupport.loggedInStore()
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil))
		let container = TestSupport.temporaryContainer()
		let saver = makeSaver(store: store, captor: captor, container: container)

		let outcome = await saver.run(url: nil, fallbackTitle: "Form.pdf", sharedPdf: { () async -> Data? in
			XCTFail("PDF bytes must not be loaded when there is no article URL")
			return nil
		})

		XCTAssertEqual(outcome, .noLink)
		XCTAssertEqual(captor.capturedURLs, [])
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "no network must be attempted without an article URL")
		XCTAssertEqual(queuedJobs(in: container), [])
		assertUploadedNothing()
	}

	func testReturnsNoSaveActionWhenServerOffersNoUrlOnlySave() async throws {
		// The queue loaded but advertised no `save-article`, so there is no link to
		// save and nothing to enrich.
		let store = TestSupport.loggedInStore()
		let container = TestSupport.temporaryContainer()
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
			container: container
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .noSaveAction)
		XCTAssertTrue(
			StubURLProtocol.records.filter { $0.request.httpMethod == "POST" }.isEmpty,
			"no save must be attempted when the server offers no save action"
		)
		XCTAssertEqual(queuedJobs(in: container), [])
		assertUploadedNothing()
	}

	func testFailsWhenQueueResponseIsUndecodable() async throws {
		// The queue replied 200 with the negotiated Siren media type but a body
		// that is not a Siren collection (a JSON array), so the journey surfaces
		// the API's own decode message as .failed — and attempts no save.
		let store = TestSupport.loggedInStore()
		let container = TestSupport.temporaryContainer()
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
			container: container
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .failed("Could not read the server response."))
		XCTAssertEqual(queuedJobs(in: container), [])
		assertUploadedNothing()
	}

	func testFailsWithAGenericMessageWhenTheTransportErrorDescribesNothing() async throws {
		// A transport failure the client cannot read a message out of still has to
		// say something the user can act on, rather than showing an empty card.
		struct WordlessTransportFailure: Error {}
		let store = TestSupport.loggedInStore()
		let container = TestSupport.temporaryContainer()
		StubURLProtocol.setHandler { _, _ in throw WordlessTransportFailure() }

		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			container: container
		)
		let outcome = await saver.run(url: URL(string: "https://example.com/post")!, fallbackTitle: nil, sharedPdf: nil)

		XCTAssertEqual(outcome, .failed("Save failed."))
		XCTAssertEqual(queuedJobs(in: container), [])
		assertUploadedNothing()
	}

	func testSurfacesTheServerSaveNoticeAsSoonAsTheListLoads() async throws {
		// The queue collection carries the server's save notice. The journey must
		// hand it to the shell as soon as the list loads — before the save lands —
		// so the caption is on screen for the whole phase it describes.
		let store = TestSupport.loggedInStore()
		let notice = "{ \"type\": \"warning\", \"content\": { \"type\": \"text/html\", \"body\": \"Don't close this — it's still saving.\" } }"
		serveQueueAndSave(messagesJSON: notice)

		var noticed: [ServerMessage] = []
		var savePostsWhenNoticed = -1
		let saver = makeSaver(
			store: store,
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: "Captured", mediaType: nil)),
			container: TestSupport.temporaryContainer()
		)
		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil,
			onNotice: { messages in
				noticed = messages
				savePostsWhenNoticed = self.urlOnlyPosts().count
			}
		)

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(
			noticed.map(\.plainText), ["Don't close this — it's still saving."],
			"the server's save notice reaches the shell verbatim"
		)
		XCTAssertEqual(savePostsWhenNoticed, 0, "the notice is up before the save it describes")
		assertUploadedNothing()
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

		XCTAssertEqual(outcome, .savedAwaitingUpload([]))
		XCTAssertEqual(callbackCount, 1, "the callback fires exactly once per save")
		XCTAssertTrue(lastMessages.isEmpty, "with no server notice, the callback carries no messages")
		assertUploadedNothing()
	}
}

@MainActor
final class FirstClaimTests: XCTestCase {
	func testTheFirstRacerTakesTheClaim() {
		XCTAssertTrue(FirstClaim().take())
	}

	func testEveryRacerAfterTheFirstIsRefused() {
		let claim = FirstClaim()

		XCTAssertTrue(claim.take())
		XCTAssertFalse(claim.take(), "a second resume of the same continuation would trap")
		XCTAssertFalse(claim.take())
	}
}
