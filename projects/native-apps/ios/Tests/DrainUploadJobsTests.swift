import XCTest
@testable import Readplace

@MainActor
final class DrainUploadJobsTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private static let epoch = Date(timeIntervalSince1970: 1_000_000)

	private func makeStore() -> UploadJobStore {
		UploadJobStore(containerURL: TestSupport.temporaryContainer())
	}

	private func job(
		id: String = "j1",
		url: String = "https://example.com/post",
		title: String? = "A Title",
		state: UploadJob.State = .capturePending(detectedMediaType: nil),
		attempts: Int = 0,
		createdAt: Date = DrainUploadJobsTests.epoch,
		nextAttemptAt: Date = DrainUploadJobsTests.epoch
	) -> UploadJob {
		UploadJob(
			id: id,
			url: url,
			title: title,
			state: state,
			attempts: attempts,
			nextAttemptAt: nextAttemptAt,
			createdAt: createdAt
		)
	}

	private func emptyCaptor() -> FakeHTMLCaptor {
		FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: nil))
	}

	private func makeDrain(
		jobs: UploadJobStore,
		captor: HTMLCapturing,
		store: TokenStore = TestSupport.loggedInStore(),
		now: @escaping () -> Date = { DrainUploadJobsTests.epoch }
	) -> DrainUploadJobs {
		DrainUploadJobs(
			api: ReadplaceAPI(
				baseURL: AppConfig.serverBaseURL,
				store: store,
				sessionConfiguration: TestSupport.stubbedConfiguration()
			),
			captor: captor,
			jobs: jobs,
			now: now
		)
	}

	private func serveReadlist(
		actionsJSON: String = Fixtures.collectionActions,
		saveContent: @escaping () -> StubURLProtocol.Stub = { .json(201, Fixtures.article(id: "a1")) }
	) {
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [], actionsJSON: actionsJSON))
			case "/queue/save-content":
				return saveContent()
			default:
				return .json(404, "{}")
			}
		}
	}

	private func parts(of upload: StubURLProtocol.Record) -> [MultipartPart] {
		TestSupport.multipartParts(
			contentType: upload.request.value(forHTTPHeaderField: "Content-Type"),
			body: upload.body
		)
	}

	// MARK: - Uploading what the share sheet staged

	func testUploadsAStagedJobThenForgetsItsRecordAndItsBytes() async throws {
		let jobs = makeStore()
		let admitted = job()
		try await jobs.admit(admitted)
		let form = TestSupport.multipartForm(content: Data("<html>staged by the share sheet</html>".utf8))
		let ready = try await jobs.stageReady(admitted, form: form)
		serveReadlist()

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		let uploads = StubURLProtocol.records(path: "/queue/save-content")
		XCTAssertEqual(uploads.count, 1)
		let upload = try XCTUnwrap(uploads.first)
		XCTAssertEqual(upload.request.httpMethod, "POST", "the upload follows the server-declared method")
		XCTAssertEqual(
			upload.request.value(forHTTPHeaderField: "Content-Type"), form.contentType,
			"the staged bytes go up under the boundary they were written with"
		)
		XCTAssertEqual(
			upload.request.value(forHTTPHeaderField: "Authorization"), "Bearer access-1",
			"the app's upload carries the bearer, so an expired token is refreshed rather than dropped"
		)
		XCTAssertEqual(
			parts(of: upload).first { $0.name == "content" }?.text,
			"<html>staged by the share sheet</html>"
		)
		XCTAssertEqual(jobs.loadAll(now: Self.epoch), [])
		XCTAssertFalse(
			FileManager.default.fileExists(atPath: jobs.bytesURL(for: ready).path),
			"an uploaded body has no reason to keep occupying the App Group container"
		)
	}

	func testFollowsTheSaveContentActionTheCurrentCollectionAdvertises() async throws {
		let jobs = makeStore()
		var saveContentHref = "/queue/save-content"
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [], actionsJSON: """
				{ "name": "save-content", "title": "Save a file", "href": "\(saveContentHref)", "method": "POST", "type": "multipart/form-data", "fields": [] }
				"""))
			case "/queue/save-content", "/queue/moved/save-content":
				return .json(201, Fixtures.article(id: "a1"))
			default:
				return .json(404, "{}")
			}
		}
		let first = job(id: "j1", url: "https://example.com/one")
		try await jobs.admit(first)
		_ = try await jobs.stageReady(first, form: TestSupport.multipartForm(url: "https://example.com/one"))

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		saveContentHref = "/queue/moved/save-content"
		let second = job(id: "j2", url: "https://example.com/two", createdAt: Self.epoch.addingTimeInterval(1))
		try await jobs.admit(second)
		_ = try await jobs.stageReady(second, form: TestSupport.multipartForm(url: "https://example.com/two"))

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertEqual(StubURLProtocol.records(path: "/queue/save-content").count, 1)
		XCTAssertEqual(
			StubURLProtocol.records(path: "/queue/moved/save-content").count, 1,
			"every sweep re-discovers, so a moved action is followed rather than posted to a remembered address"
		)
		XCTAssertEqual(jobs.loadAll(now: Self.epoch.addingTimeInterval(1)), [])
	}

	// MARK: - Capturing what the share sheet left pending

	func testCapturesAPendingJobOnDeviceThenUploadsWhatItRendered() async throws {
		let jobs = makeStore()
		try await jobs.admit(job(title: "Title from the share sheet"))
		serveReadlist()
		let captor = FakeHTMLCaptor(
			page: CapturedPage(rawHtml: "<html>rendered in the app</html>", title: "Rendered", mediaType: "text/html")
		)

		await makeDrain(jobs: jobs, captor: captor).run()

		XCTAssertEqual(captor.capturedURLs.map(\.absoluteString), ["https://example.com/post"])
		let upload = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		XCTAssertEqual(parts(of: upload).first { $0.name == "url" }?.text, "https://example.com/post")
		XCTAssertEqual(parts(of: upload).first { $0.name == "mediaType" }?.text, "text/html")
		XCTAssertEqual(
			parts(of: upload).first { $0.name == "title" }?.text, "Rendered",
			"the rendered page names itself; the shared title is only the fallback"
		)
		XCTAssertEqual(parts(of: upload).first { $0.name == "content" }?.text, "<html>rendered in the app</html>")
		XCTAssertEqual(jobs.loadAll(now: Self.epoch), [])
	}

	func testFetchesThePdfItselfForAPdfHintedJobWithoutTheBearer() async throws {
		let jobs = makeStore()
		let pdfBytes = Data("%PDF-1.7 the paper".utf8)
		try await jobs.admit(job(
			url: "https://example.com/paper.pdf",
			state: .capturePending(detectedMediaType: "application/pdf")
		))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: []))
			case "/paper.pdf":
				return StubURLProtocol.Stub(status: 200, headers: ["Content-Type": "application/pdf"], body: pdfBytes)
			case "/queue/save-content":
				return .json(201, Fixtures.article(id: "a1"))
			default:
				return .json(404, "{}")
			}
		}
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>never rendered</html>", title: nil, mediaType: "text/html"))

		await makeDrain(jobs: jobs, captor: captor).run()

		XCTAssertEqual(captor.capturedURLs, [], "a PDF is fetched as bytes, never rendered")
		let fetch = try XCTUnwrap(StubURLProtocol.records(path: "/paper.pdf").first)
		XCTAssertNil(
			fetch.request.value(forHTTPHeaderField: "Authorization"),
			"a third-party origin must never see the Readplace bearer"
		)
		let upload = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		XCTAssertEqual(parts(of: upload).first { $0.name == "mediaType" }?.text, "application/pdf")
		XCTAssertEqual(parts(of: upload).first { $0.name == "title" }?.text, "A Title")
		XCTAssertEqual(parts(of: upload).first { $0.name == "content" }?.body, pdfBytes)
		XCTAssertEqual(jobs.loadAll(now: Self.epoch), [])
	}

	func testDropsAPdfHintedJobWhoseFetchBringsBackSomethingThatIsNotAPdf() async throws {
		let jobs = makeStore()
		try await jobs.admit(job(
			url: "https://example.com/paper.pdf",
			state: .capturePending(detectedMediaType: "application/pdf")
		))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: []))
			case "/paper.pdf":
				return StubURLProtocol.Stub(
					status: 200,
					headers: ["Content-Type": "text/html"],
					body: Data("<html>sign in to read this paper</html>".utf8)
				)
			default:
				return .json(404, "{}")
			}
		}

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertTrue(
			StubURLProtocol.records(path: "/queue/save-content").isEmpty,
			"bytes that are not the PDF they claim to be are never uploaded as one"
		)
		XCTAssertEqual(jobs.loadAll(now: Self.epoch), [])
	}

	func testDropsAPendingJobWhoseOnDeviceCaptureComesBackEmpty() async throws {
		let jobs = makeStore()
		try await jobs.admit(job())
		serveReadlist()
		let captor = emptyCaptor()

		await makeDrain(jobs: jobs, captor: captor).run()

		XCTAssertEqual(captor.capturedURLs.map(\.absoluteString), ["https://example.com/post"])
		XCTAssertTrue(
			StubURLProtocol.records(path: "/queue/save-content").isEmpty,
			"with nothing rendered the server's own crawl is the last resort, so nothing is uploaded"
		)
		XCTAssertEqual(jobs.loadAll(now: Self.epoch), [])
	}

	// MARK: - What the server's answer decides

	func testDropsAJobTheServerRefusesWithItsOwnVerdict() async throws {
		let jobs = makeStore()
		let admitted = job()
		try await jobs.admit(admitted)
		let ready = try await jobs.stageReady(admitted, form: TestSupport.multipartForm())
		serveReadlist(saveContent: { .json(403, Fixtures.accountLockedError()) })

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertEqual(
			jobs.loadAll(now: Self.epoch), [],
			"a refusal is the server's verdict on these exact bytes, and the link itself is already saved"
		)
		XCTAssertFalse(FileManager.default.fileExists(atPath: jobs.bytesURL(for: ready).path))
	}

	func testDropsAJobTheServerRejectsWithA4xx() async throws {
		let jobs = makeStore()
		let admitted = job()
		try await jobs.admit(admitted)
		let ready = try await jobs.stageReady(admitted, form: TestSupport.multipartForm())
		serveReadlist(saveContent: {
			.json(415, Fixtures.sirenError(code: "unsupported_media_type", message: "That content can't be saved."))
		})

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertEqual(jobs.loadAll(now: Self.epoch), [], "resending bytes the server already judged would only be judged the same way")
		XCTAssertFalse(FileManager.default.fileExists(atPath: jobs.bytesURL(for: ready).path))
	}

	func testSchedulesABackoffRetryWhenTheServerFailsTransiently() async throws {
		let jobs = makeStore()
		let admitted = job()
		try await jobs.admit(admitted)
		let ready = try await jobs.stageReady(admitted, form: TestSupport.multipartForm())
		serveReadlist(saveContent: { .json(503, Fixtures.sirenError(code: "unavailable", message: "Try again later.")) })

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertEqual(jobs.loadAll(now: Self.epoch), [], "the job waits out its backoff rather than being retried on this sweep")
		let waiting = try XCTUnwrap(jobs.loadAll(now: Self.epoch.addingTimeInterval(60)).first)
		XCTAssertEqual(waiting.attempts, 1)
		XCTAssertEqual(waiting.nextAttemptAt, Self.epoch.addingTimeInterval(60))
		XCTAssertTrue(
			FileManager.default.fileExists(atPath: jobs.bytesURL(for: ready).path),
			"the staged bytes survive the failure, so the retry has something to send"
		)
	}

	func testKeepsAMidSweepCaptureStagedWhenItsUploadFailsTransiently() async throws {
		let jobs = makeStore()
		try await jobs.admit(job())
		serveReadlist(saveContent: { .json(503, Fixtures.sirenError(code: "unavailable", message: "Try again later.")) })
		let captor = FakeHTMLCaptor(
			page: CapturedPage(rawHtml: "<html>rendered once</html>", title: "Rendered", mediaType: "text/html")
		)

		await makeDrain(jobs: jobs, captor: captor).run()

		let waiting = try XCTUnwrap(jobs.loadAll(now: Self.epoch.addingTimeInterval(60)).first)
		XCTAssertEqual(waiting.attempts, 1)
		XCTAssertTrue(
			FileManager.default.fileExists(atPath: jobs.bytesURL(for: waiting).path),
			"the render already happened; losing it to the retry would re-pay the capture"
		)

		serveReadlist()
		await makeDrain(jobs: jobs, captor: captor, now: { Self.epoch.addingTimeInterval(60) }).run()

		XCTAssertEqual(
			captor.capturedURLs.map(\.absoluteString), ["https://example.com/post"],
			"the retry sends the bytes it already staged instead of rendering the page again"
		)
		let uploads = StubURLProtocol.records(path: "/queue/save-content")
		XCTAssertEqual(uploads.count, 2)
		let retried = try XCTUnwrap(uploads.last)
		XCTAssertEqual(parts(of: retried).first { $0.name == "content" }?.text, "<html>rendered once</html>")
		XCTAssertEqual(jobs.loadAll(now: Self.epoch.addingTimeInterval(60)), [])
	}

	func testDropsAJobThatHasSpentItsWholeRetryBudget() async throws {
		let jobs = makeStore()
		let admitted = job(attempts: 7)
		try await jobs.admit(admitted)
		let ready = try await jobs.stageReady(admitted, form: TestSupport.multipartForm())
		serveReadlist(saveContent: { .json(503, "{}") })

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertEqual(jobs.loadAll(now: Self.epoch.addingTimeInterval(86_400)), [])
		XCTAssertFalse(FileManager.default.fileExists(atPath: jobs.bytesURL(for: ready).path))
	}

	func testStopsTheSweepWhenTheSessionCannotBeRefreshed() async throws {
		let jobs = makeStore()
		let first = job(id: "j1", url: "https://example.com/one")
		try await jobs.admit(first)
		let readyFirst = try await jobs.stageReady(first, form: TestSupport.multipartForm(url: "https://example.com/one"))
		let second = job(id: "j2", url: "https://example.com/two", createdAt: Self.epoch.addingTimeInterval(1))
		try await jobs.admit(second)
		let readySecond = try await jobs.stageReady(second, form: TestSupport.multipartForm(url: "https://example.com/two"))
		serveReadlist(saveContent: { .json(401, "{}") })

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertEqual(
			StubURLProtocol.records(path: "/queue/save-content").count, 1,
			"the one refresh inside send() already ran and failed, so a second job would only race a rotating refresh token"
		)
		XCTAssertEqual(
			jobs.loadAll(now: Self.epoch.addingTimeInterval(1)), [readyFirst, readySecond],
			"a dead session costs no job its place in the readlist"
		)
	}

	// MARK: - Sweeps that never reach an upload

	func testDropsEveryDueJobWhenTheServerAdvertisesNoSaveContent() async throws {
		let jobs = makeStore()
		let staged = job(id: "j1", url: "https://example.com/one")
		try await jobs.admit(staged)
		let ready = try await jobs.stageReady(staged, form: TestSupport.multipartForm(url: "https://example.com/one"))
		try await jobs.admit(job(id: "j2", url: "https://example.com/two", createdAt: Self.epoch.addingTimeInterval(1)))
		let saveArticleOnly = """
		{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }
		"""
		serveReadlist(actionsJSON: saveArticleOnly)
		let captor = FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html>hi</html>", title: nil, mediaType: "text/html"))

		await makeDrain(jobs: jobs, captor: captor).run()

		XCTAssertEqual(
			jobs.loadAll(now: Self.epoch.addingTimeInterval(1)), [],
			"with no advertised home for the content nothing will ever upload them, so they are not kept forever"
		)
		XCTAssertFalse(FileManager.default.fileExists(atPath: jobs.bytesURL(for: ready).path))
		XCTAssertEqual(captor.capturedURLs, [], "there is no point rendering a page nothing can receive")
		XCTAssertTrue(StubURLProtocol.records.filter { $0.request.httpMethod == "POST" }.isEmpty)
	}

	func testLeavesAJobAloneUntilItsNextAttemptTimeArrives() async throws {
		let jobs = makeStore()
		let waiting = job(nextAttemptAt: Self.epoch.addingTimeInterval(60))
		try await jobs.admit(waiting)
		let ready = try await jobs.stageReady(waiting, form: TestSupport.multipartForm())
		serveReadlist()

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertTrue(StubURLProtocol.records.isEmpty, "a sweep with nothing due costs no round trip at all")
		XCTAssertEqual(jobs.loadAll(now: Self.epoch.addingTimeInterval(60)), [ready])
	}

	func testStopsTheSweepTheMomentTheSessionIsGone() async throws {
		let jobs = makeStore()
		let store = TestSupport.loggedInStore()
		let first = job(id: "j1", url: "https://example.com/one")
		try await jobs.admit(first)
		_ = try await jobs.stageReady(first, form: TestSupport.multipartForm(url: "https://example.com/one"))
		let second = job(id: "j2", url: "https://example.com/two", createdAt: Self.epoch.addingTimeInterval(1))
		try await jobs.admit(second)
		let readySecond = try await jobs.stageReady(second, form: TestSupport.multipartForm(url: "https://example.com/two"))
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: []))
			case "/queue/save-content":
				store.clear()
				return .json(201, Fixtures.article(id: "a1"))
			default:
				return .json(404, "{}")
			}
		}

		await makeDrain(jobs: jobs, captor: emptyCaptor(), store: store).run()

		XCTAssertEqual(
			StubURLProtocol.records(path: "/queue/save-content").count, 1,
			"a session that vanished mid-sweep sends no further bytes under whatever token comes next"
		)
		XCTAssertEqual(
			jobs.loadAll(now: Self.epoch.addingTimeInterval(1)), [readySecond],
			"the stranded job keeps its place and its retry budget"
		)
	}

	func testSweepsAnOrphanedBodyEvenWhenNothingIsDue() async throws {
		let jobs = makeStore()
		let orphan = jobs.bytesURL(for: job(id: "orphan"))
		try FileManager.default.createDirectory(
			at: orphan.deletingLastPathComponent(),
			withIntermediateDirectories: true
		)
		try Data("stranded".utf8).write(to: orphan)

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertFalse(
			FileManager.default.fileExists(atPath: orphan.path),
			"a body whose record is gone can never upload, so the sweep reclaims its space"
		)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "sweeping local garbage costs no round trip")
	}

	func testLeavesEveryJobAloneWhenDiscoveryFails() async throws {
		let jobs = makeStore()
		let admitted = job()
		try await jobs.admit(admitted)
		let ready = try await jobs.stageReady(admitted, form: TestSupport.multipartForm())
		StubURLProtocol.setHandler { _, _ in .json(503, "{}") }

		await makeDrain(jobs: jobs, captor: emptyCaptor()).run()

		XCTAssertEqual(
			jobs.loadAll(now: Self.epoch), [ready],
			"a server the sweep could not even reach spends none of the job's retry budget"
		)
		XCTAssertTrue(StubURLProtocol.records(path: "/queue/save-content").isEmpty)
	}
}
