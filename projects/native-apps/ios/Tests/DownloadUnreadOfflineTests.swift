import XCTest
@testable import Readplace

@MainActor
final class DownloadUnreadOfflineTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private final class ProgressLog {
		var values: [OfflineDownloadProgress] = []
	}

	private static let secondPageLink = ",{ \"rel\": [\"next\"], \"href\": \"/queue?status=unread&page=2\" }"

	private var container = AppGroupContainer(url: TestSupport.temporaryContainer())

	private func makeDownload(
		prefetchers: [ReaderPrefetching],
		manifest: OfflineDownloadManifest? = nil
	) -> DownloadUnreadOffline {
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL,
			store: TestSupport.loggedInStore(),
			nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
		return DownloadUnreadOffline(
			api: api,
			prefetchers: prefetchers,
			sessionAction: nil,
			manifest: manifest ?? OfflineDownloadManifest(container: container),
			snapshot: OfflineReadlistSnapshot(container: container)
		)
	}

	private func makeDownload(prefetcher: ReaderPrefetching) -> DownloadUnreadOffline {
		makeDownload(prefetchers: [prefetcher])
	}

	private func serveTwoPages(
		firstPage: [String],
		secondPage: [String],
		failingSecondPage: Error? = nil,
		holdingSecondPage gate: DispatchSemaphore? = nil,
		mintStatus: Int = 204
	) {
		StubURLProtocol.setHandler { request, _ in
			switch (request.url?.path, request.url?.query) {
			case ("/queue", "status=unread"):
				return .json(200, Fixtures.collection(entitiesJSON: firstPage, extraLinks: Self.secondPageLink))
			case ("/queue", "status=unread&page=2"):
				if let failingSecondPage { throw failingSecondPage }
				let page = StubURLProtocol.Stub.json(200, Fixtures.collection(entitiesJSON: secondPage, page: 2))
				return gate.map { page.held(until: $0) } ?? page
			case ("/auth/session", _):
				return StubURLProtocol.Stub(
					status: mintStatus,
					headers: ["Set-Cookie": "hutch_sid=sess-offline; Path=/; HttpOnly"]
				)
			default:
				return .json(404, "{}")
			}
		}
	}

	private func requested() -> [String] {
		StubURLProtocol.records.map { record in
			let url = record.request.url
			return [url?.path ?? "", url?.query].compactMap { $0 }.joined(separator: "?")
		}
	}

	private func progress(_ completed: Int, of total: Int, failed: Int) -> OfflineDownloadProgress {
		OfflineDownloadProgress(completed: completed, total: total, failed: failed)
	}

	func testWalksEveryPageOfTheTabAndPrefetchesEachUnreadArticleWithTheMintedSession() async throws {
		serveTwoPages(
			firstPage: [Fixtures.article(id: "a1"), Fixtures.article(id: "r1", status: "read", isRead: true)],
			secondPage: [Fixtures.article(id: "a2")]
		)
		let prefetcher = FakeReaderPrefetcher()
		var reported: [OfflineDownloadProgress] = []

		let outcome = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread", expectedTotal: 0) {
			reported.append($0)
		}

		XCTAssertEqual(outcome, .downloaded)
		XCTAssertEqual(
			Set(requested()), ["/queue?status=unread", "/queue?status=unread&page=2", "/auth/session"],
			"the client follows the server's next link to the end and mints one session for the whole download"
		)
		XCTAssertEqual(StubURLProtocol.records(path: "/auth/session").count, 1)
		XCTAssertEqual(
			prefetcher.prefetched.map { $0.request.url?.absoluteString },
			["\(AppConfig.serverBaseURL)/queue/a1/view?platform=ios", "\(AppConfig.serverBaseURL)/queue/a2/view?platform=ios"],
			"only unread articles are downloaded, in list order, at the URL the reader opens"
		)
		XCTAssertEqual(
			prefetcher.prefetched.map { $0.request.allHTTPHeaderFields ?? [:] },
			[["Sec-Purpose": "prefetch"], ["Sec-Purpose": "prefetch"]],
			"a download says it is a prefetch so the server does not count it as the reader opening the article"
		)
		XCTAssertEqual(prefetcher.prefetched.map { $0.cookies.map(\.value) }, [["sess-offline"], ["sess-offline"]])
		XCTAssertEqual(reported.first, progress(0, of: 1, failed: 0), "the count shows as soon as the first page is read")
		XCTAssertEqual(reported.last, progress(2, of: 2, failed: 0))
	}

	func testTheDownloadWaitsForWebKitToStoreTheLastArticleBeforeItFinishes() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher()

		_ = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread", expectedTotal: 0) { _ in }

		XCTAssertEqual(
			prefetcher.events,
			["prefetch /queue/a1/view", "prefetch /queue/a2/view", "wait until stored"],
			"WebKit writes a stored copy to disk about a second after the load, so the download waits once after the last article"
		)
	}

	func testAnArticleThatFailsToDownloadDoesNotStopTheRest() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher(results: [false, true])
		var reported: [OfflineDownloadProgress] = []

		let outcome = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread", expectedTotal: 0) {
			reported.append($0)
		}

		XCTAssertEqual(outcome, .partiallyDownloaded(failed: 1, total: 2))
		XCTAssertEqual(prefetcher.prefetched.map { $0.request.url?.path }, ["/queue/a1/view", "/queue/a2/view"])
		XCTAssertEqual(reported.last, progress(2, of: 2, failed: 1))
	}

	func testCancellingStopsBeforeTheNextArticle() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher()
		let log = ProgressLog()
		let download = makeDownload(prefetcher: prefetcher)
		let task = Task { try await download.run(from: "/queue?status=unread", expectedTotal: 0) { log.values.append($0) } }
		prefetcher.onPrefetch = { task.cancel() }

		let outcome = try await task.value

		XCTAssertEqual(outcome, .cancelled)
		XCTAssertEqual(prefetcher.events, ["prefetch /queue/a1/view"], "the second article is never requested")
		XCTAssertFalse(log.values.contains { $0.completed > 0 }, "the cancelled article is not counted as downloaded")
	}

	func testCancellingWhileTheListIsReadEndsCancelledRatherThanFailed() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher()
		let download = makeDownload(prefetcher: prefetcher)
		let task = Task { try await download.run(from: "/queue?status=unread", expectedTotal: 0) { _ in } }
		task.cancel()

		let outcome = try await task.value

		XCTAssertEqual(outcome, .cancelled, "the cancelled list read is the user's cancel, not an error to show")
		XCTAssertEqual(prefetcher.events, [])
	}

	func testNothingUnreadMintsNoSessionAndDownloadsNothing() async throws {
		serveTwoPages(
			firstPage: [Fixtures.article(id: "r1", status: "read", isRead: true)],
			secondPage: [Fixtures.article(id: "r2", status: "read", isRead: true)]
		)
		let prefetcher = FakeReaderPrefetcher()
		let manifest = OfflineDownloadManifest(container: container)
		var reported: [OfflineDownloadProgress] = []

		let outcome = try await makeDownload(prefetchers: [prefetcher], manifest: manifest)
			.run(from: "/queue?status=unread", expectedTotal: 0) { reported.append($0) }

		XCTAssertEqual(outcome, .nothingToDownload)
		XCTAssertEqual(requested(), ["/queue?status=unread", "/queue?status=unread&page=2"])
		XCTAssertEqual(prefetcher.events, [])
		XCTAssertTrue(reported.allSatisfy { $0 == progress(0, of: 0, failed: 0) })
		XCTAssertNil(manifest.run, "a run with nothing to download leaves nothing to resume")
	}

	func testAListPageThatCannotBeReadFailsTheDownload() async {
		serveTwoPages(
			firstPage: [Fixtures.article(id: "r1", status: "read", isRead: true)],
			secondPage: [],
			failingSecondPage: URLError(.notConnectedToInternet)
		)
		let prefetcher = FakeReaderPrefetcher()

		do {
			_ = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread", expectedTotal: 0) { _ in }
			XCTFail("a list page that cannot be read must fail the download")
		} catch {
			XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet)
		}
		XCTAssertEqual(prefetcher.events, [])
		XCTAssertEqual(StubURLProtocol.records(path: "/auth/session").count, 0)
	}

	func testASessionThatCannotBeMintedFailsTheDownload() async {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [], mintStatus: 500)
		let prefetcher = FakeReaderPrefetcher()

		do {
			_ = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread", expectedTotal: 0) { _ in }
			XCTFail("an unauthenticated download would store sign-in pages, so a failed mint must fail it")
		} catch APIError.server(let status, _, _) {
			XCTAssertEqual(status, 500)
		} catch {
			XCTFail("expected the mint's server error, got \(error)")
		}
		XCTAssertEqual(prefetcher.events, [])
	}

	func testArticlesStartDownloadingBeforeTheLastListPageArrives() async throws {
		let gate = DispatchSemaphore(value: 0)
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")], holdingSecondPage: gate)
		let prefetcher = FakeReaderPrefetcher()
		let firstArticle = expectation(description: "the first page's article is downloading")
		firstArticle.assertForOverFulfill = false
		prefetcher.onPrefetch = { firstArticle.fulfill() }
		let download = makeDownload(prefetcher: prefetcher)
		let task = Task { try await download.run(from: "/queue?status=unread", expectedTotal: 0) { _ in } }

		await fulfillment(of: [firstArticle], timeout: 5)
		XCTAssertEqual(
			prefetcher.events, ["prefetch /queue/a1/view"],
			"the first page's article downloads while the second page is still on its way"
		)
		gate.signal()
		let outcome = try await task.value

		XCTAssertEqual(outcome, .downloaded)
		XCTAssertEqual(prefetcher.prefetched.map { $0.request.url?.path }, ["/queue/a1/view", "/queue/a2/view"])
	}

	func testNoMoreThanFourArticlesDownloadAtOnce() async throws {
		let firstPage = (1...6).map { Fixtures.article(id: "a\($0)") }
		let secondPage = (7...10).map { Fixtures.article(id: "a\($0)") }
		serveTwoPages(firstPage: firstPage, secondPage: secondPage)
		let probe = InFlightProbe()
		let prefetchers = (0..<DownloadUnreadOffline.concurrentArticles).map { _ in FakeReaderPrefetcher(probe: probe) }
		let download = makeDownload(prefetchers: prefetchers)
		let task = Task { try await download.run(from: "/queue?status=unread", expectedTotal: 0) { _ in } }

		while probe.current < DownloadUnreadOffline.concurrentArticles { await Task.yield() }
		for _ in 0..<100 { await Task.yield() }
		XCTAssertEqual(probe.maximum, 4, "four web views load at once and the fifth article waits for one of them")
		probe.open()
		let outcome = try await task.value

		XCTAssertEqual(outcome, .downloaded)
		XCTAssertEqual(probe.maximum, 4)
		XCTAssertEqual(prefetchers.map(\.prefetched.count).reduce(0, +), 10, "every article is downloaded exactly once")
		XCTAssertEqual(StubURLProtocol.records(path: "/auth/session").count, 1, "the four web views share one minted session")
	}

	func testADownloadedArticleIsRecordedWithTheVersionItWasStoredAt() async throws {
		serveTwoPages(
			firstPage: [Fixtures.article(id: "a1", contentVersion: "v1")],
			secondPage: [Fixtures.article(id: "a2", contentVersion: "v2")]
		)
		let manifest = OfflineDownloadManifest(container: container)

		_ = try await makeDownload(prefetchers: [FakeReaderPrefetcher(results: [true, false])], manifest: manifest)
			.run(from: "/queue?status=unread", expectedTotal: 0) { _ in }

		XCTAssertTrue(manifest.isCurrent(articleId: "a1", contentVersion: "v1"))
		XCTAssertFalse(manifest.isCurrent(articleId: "a2", contentVersion: "v2"), "an article that failed is not offline")
	}

	func testAResumedDownloadSkipsArticlesAlreadyStoredAtTheirCurrentVersion() async throws {
		serveTwoPages(
			firstPage: [Fixtures.article(id: "a1", contentVersion: "v1"), Fixtures.article(id: "a2", contentVersion: "v2-new")],
			secondPage: [Fixtures.article(id: "a3", contentVersion: "v3")]
		)
		let manifest = OfflineDownloadManifest(container: container)
		manifest.recordDownloaded(articleId: "a1", contentVersion: "v1")
		manifest.recordDownloaded(articleId: "a2", contentVersion: "v2-old")
		manifest.record(run: OfflineDownloadRun(total: 3, completed: 1))
		let prefetcher = FakeReaderPrefetcher()
		var reported: [OfflineDownloadProgress] = []

		let outcome = try await makeDownload(prefetchers: [prefetcher], manifest: manifest)
			.run(from: "/queue?status=unread", expectedTotal: 3) { reported.append($0) }

		XCTAssertEqual(outcome, .downloaded)
		XCTAssertEqual(
			prefetcher.prefetched.map { $0.request.url?.path }, ["/queue/a2/view", "/queue/a3/view"],
			"a current copy is counted without a download; one whose article was re-crawled is downloaded again"
		)
		XCTAssertEqual(reported.first, progress(0, of: 3, failed: 0), "the last run's total shows before the walk recounts it")
		XCTAssertEqual(reported.last, progress(3, of: 3, failed: 0))
		XCTAssertNil(manifest.run, "a finished run leaves nothing to resume")
	}

	func testARunThatStopsPartWayIsRecordedForTheNextLaunch() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher()
		let manifest = OfflineDownloadManifest(container: container)
		let download = makeDownload(prefetchers: [prefetcher], manifest: manifest)
		var task: Task<OfflineDownloadOutcome, Error>?
		prefetcher.onPrefetch = { if prefetcher.prefetched.count == 2 { task?.cancel() } }
		task = Task { try await download.run(from: "/queue?status=unread", expectedTotal: 0) { _ in } }

		let outcome = try await XCTUnwrap(task).value

		XCTAssertEqual(outcome, .cancelled)
		XCTAssertEqual(manifest.run, OfflineDownloadRun(total: 2, completed: 1))
		XCTAssertEqual(OfflineDownloadManifest(container: container).incompleteRun, OfflineDownloadRun(total: 2, completed: 1))
	}

	func testEveryListPageTheDownloadReadsIsKeptForOffline() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])

		_ = try await makeDownload(prefetcher: FakeReaderPrefetcher()).run(from: "/queue?status=unread", expectedTotal: 0) { _ in }

		let snapshot = OfflineReadlistSnapshot(container: container)
		XCTAssertEqual(snapshot.page(href: "/queue?status=unread", now: Date())?.articles.map(\.id), ["a1"])
		XCTAssertEqual(snapshot.page(href: "/queue?status=unread&page=2", now: Date())?.articles.map(\.id), ["a2"])
	}

	func testTheProgressLabelCountsTheArticlesDownloadedSoFar() {
		XCTAssertEqual(progress(1, of: 3, failed: 0).label, "Downloading 1 of 3 for offline reading")
		XCTAssertEqual(progress(0, of: 3, failed: 0).label, "Downloading 0 of 3 for offline reading")
		XCTAssertEqual(progress(1, of: 4, failed: 0).fraction, 0.25)
	}

	func testBeforeTheUnreadArticlesAreCountedTheProgressSaysItIsFindingThem() {
		XCTAssertEqual(progress(0, of: 0, failed: 0).label, "Finding unread articles…")
		XCTAssertEqual(progress(0, of: 0, failed: 0).fraction, 0)
	}

	func testAnIncompleteRunSaysHowFarItGot() {
		let run = OfflineDownloadRun(total: 1296, completed: 312)
		XCTAssertEqual(run.resumeLabel, "312 of 1296 downloaded for offline reading")
		XCTAssertEqual(OfflineDownloadRun(total: 4, completed: 1).fraction, 0.25)
		XCTAssertEqual(OfflineDownloadRun(total: 0, completed: 0).fraction, 0)
		XCTAssertTrue(run.isIncomplete)
		XCTAssertFalse(OfflineDownloadRun(total: 3, completed: 3).isIncomplete)
	}

	func testOnlyAPartialDownloadHasAFailureToReport() {
		XCTAssertEqual(
			OfflineDownloadOutcome.partiallyDownloaded(failed: 1, total: 3).failureText,
			"1 of 3 articles couldn't be downloaded for offline reading"
		)
		XCTAssertEqual(
			[OfflineDownloadOutcome.downloaded, .cancelled, .nothingToDownload].map(\.failureText),
			[nil, nil, nil]
		)
	}

	func testOnlyAPageTheServerAnsweredInFullCountsAsStored() {
		XCTAssertEqual(
			[200, nil, 404, 500].map { ReaderPrefetch.wasStored(mainFrameStatus: $0, mainDocumentLoaded: true) },
			[true, false, false, false],
			"a load WebKit finished without a main-frame response stored nothing"
		)
	}

	func testAPageCutOffAfterItsHeadersArrivedDoesNotCountAsStored() {
		XCTAssertEqual(
			[200, nil, 404].map { ReaderPrefetch.wasStored(mainFrameStatus: $0, mainDocumentLoaded: false) },
			[false, false, false],
			"WebKit stores a page only once its document arrived in full, so a 200 whose body was cut off stored nothing"
		)
	}
}
