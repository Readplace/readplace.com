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

	private func makeDownload(prefetcher: ReaderPrefetching) -> DownloadUnreadOffline {
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL,
			store: TestSupport.loggedInStore(),
			nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
		return DownloadUnreadOffline(api: api, prefetcher: prefetcher, sessionAction: nil)
	}

	private func serveTwoPages(
		firstPage: [String],
		secondPage: [String],
		failingSecondPage: Error? = nil,
		mintStatus: Int = 204
	) {
		StubURLProtocol.setHandler { request, _ in
			switch (request.url?.path, request.url?.query) {
			case ("/queue", "status=unread"):
				return .json(200, Fixtures.collection(entitiesJSON: firstPage, extraLinks: Self.secondPageLink))
			case ("/queue", "status=unread&page=2"):
				if let failingSecondPage { throw failingSecondPage }
				return .json(200, Fixtures.collection(entitiesJSON: secondPage, page: 2))
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

		let outcome = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread") {
			reported.append($0)
		}

		XCTAssertEqual(outcome, .downloaded)
		XCTAssertEqual(
			requested(), ["/queue?status=unread", "/queue?status=unread&page=2", "/auth/session"],
			"the client follows the server's next link to the end, then mints one session for the whole download"
		)
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
		XCTAssertEqual(reported, [progress(0, of: 2, failed: 0), progress(1, of: 2, failed: 0), progress(2, of: 2, failed: 0)])
	}

	func testTheDownloadWaitsForWebKitToStoreTheLastArticleBeforeItFinishes() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher()

		_ = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread") { _ in }

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

		let outcome = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread") {
			reported.append($0)
		}

		XCTAssertEqual(outcome, .partiallyDownloaded(failed: 1, total: 2))
		XCTAssertEqual(prefetcher.prefetched.map { $0.request.url?.path }, ["/queue/a1/view", "/queue/a2/view"])
		XCTAssertEqual(reported, [progress(0, of: 2, failed: 0), progress(1, of: 2, failed: 1), progress(2, of: 2, failed: 1)])
	}

	func testCancellingStopsBeforeTheNextArticle() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher()
		let log = ProgressLog()
		let download = makeDownload(prefetcher: prefetcher)
		let task = Task { try await download.run(from: "/queue?status=unread") { log.values.append($0) } }
		prefetcher.onPrefetch = { task.cancel() }

		let outcome = try await task.value

		XCTAssertEqual(outcome, .cancelled)
		XCTAssertEqual(prefetcher.events, ["prefetch /queue/a1/view"], "the second article is never requested")
		XCTAssertEqual(log.values, [progress(0, of: 2, failed: 0), progress(1, of: 2, failed: 0)])
	}

	func testCancellingWhileTheListIsReadEndsCancelledRatherThanFailed() async throws {
		serveTwoPages(firstPage: [Fixtures.article(id: "a1")], secondPage: [Fixtures.article(id: "a2")])
		let prefetcher = FakeReaderPrefetcher()
		let download = makeDownload(prefetcher: prefetcher)
		let task = Task { try await download.run(from: "/queue?status=unread") { _ in } }
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
		var reported: [OfflineDownloadProgress] = []

		let outcome = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread") {
			reported.append($0)
		}

		XCTAssertEqual(outcome, .nothingToDownload)
		XCTAssertEqual(requested(), ["/queue?status=unread", "/queue?status=unread&page=2"])
		XCTAssertEqual(prefetcher.events, [])
		XCTAssertEqual(reported, [])
	}

	func testAListPageThatCannotBeReadFailsTheDownload() async {
		serveTwoPages(
			firstPage: [Fixtures.article(id: "a1")],
			secondPage: [],
			failingSecondPage: URLError(.notConnectedToInternet)
		)
		let prefetcher = FakeReaderPrefetcher()

		do {
			_ = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread") { _ in }
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
			_ = try await makeDownload(prefetcher: prefetcher).run(from: "/queue?status=unread") { _ in }
			XCTFail("an unauthenticated download would store sign-in pages, so a failed mint must fail it")
		} catch APIError.server(let status, _, _) {
			XCTAssertEqual(status, 500)
		} catch {
			XCTFail("expected the mint's server error, got \(error)")
		}
		XCTAssertEqual(prefetcher.events, [])
	}

	func testTheProgressLabelCountsTheArticlesDownloadedSoFar() {
		XCTAssertEqual(progress(1, of: 3, failed: 0).label, "Downloading 1 of 3 for offline reading")
		XCTAssertEqual(progress(1, of: 4, failed: 0).fraction, 0.25)
	}

	func testBeforeTheUnreadArticlesAreCountedTheProgressSaysItIsFindingThem() {
		XCTAssertEqual(progress(0, of: 0, failed: 0).label, "Finding unread articles…")
		XCTAssertEqual(progress(0, of: 0, failed: 0).fraction, 0)
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
