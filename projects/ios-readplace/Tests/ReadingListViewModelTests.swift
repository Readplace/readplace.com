import XCTest
@testable import Readplace

@MainActor
final class ReadingListViewModelTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeViewModel(store: TokenStore) -> ReadingListViewModel {
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL,
			store: store,
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
		return ReadingListViewModel(api: api, onSessionExpired: {})
	}

	// MARK: - Add-links help discovery

	/// A single-page `/queue` whose collection carries the given extra links.
	private func queueHandler(extraLinks: String = "") -> (URLRequest, Data) -> StubURLProtocol.Stub {
		return { request, _ in
			switch request.url?.path ?? "" {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a1")],
					extraLinks: extraLinks
				))
			default:
				return .json(404, "{}")
			}
		}
	}

	/// A two-page `/queue`: the first page advertises both a `next` link and the
	/// `add-links-help` link; the second page (followed via `next`) omits the help
	/// link, modelling a server that stops advertising it on a later page.
	private func twoPageHelpHandler() -> (URLRequest, Data) -> StubURLProtocol.Stub {
		return { request, _ in
			switch (request.url?.path ?? "", request.url?.query ?? "") {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", "page=2"):
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a2")],
					page: 2,
					total: 2
				))
			case ("/queue", _):
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a1")],
					extraLinks: ", { \"rel\": [\"next\"], \"href\": \"/queue?page=2\" }"
						+ ", { \"rel\": [\"add-links-help\"], \"href\": \"/help/add-links\" }",
					total: 2
				))
			default:
				return .json(404, "{}")
			}
		}
	}

	func testRefreshDiscoversAddLinksHelpURL() async {
		StubURLProtocol.setHandler(queueHandler(
			extraLinks: ", { \"rel\": [\"add-links-help\"], \"href\": \"/help/add-links\" }"
		))
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		XCTAssertEqual(
			viewModel.addLinksHelpURL?.absoluteString,
			"\(AppConfig.serverBaseURL)/help/add-links"
		)
	}

	func testAddLinksHelpURLIsNilWhenCollectionOmitsTheLink() async {
		StubURLProtocol.setHandler(queueHandler())
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		XCTAssertNil(viewModel.addLinksHelpURL)
	}

	func testAddLinksHelpURLSurvivesALaterPageThatOmitsTheLink() async {
		StubURLProtocol.setHandler(twoPageHelpHandler())
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		let resolved = viewModel.addLinksHelpURL
		XCTAssertNotNil(resolved, "the first page advertises the help link")

		await viewModel.loadMore()

		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"], "the next page is appended")
		XCTAssertEqual(
			viewModel.addLinksHelpURL, resolved,
			"a later page that omits the help link must not clear an already-resolved URL"
		)
	}

	func testAddLinksHelpURLStaysNilForAnUnresolvableHelpHref() async {
		StubURLProtocol.setHandler(queueHandler(
			extraLinks: ", { \"rel\": [\"add-links-help\"], \"href\": \"mailto:help@example.com\" }"
		))
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		XCTAssertNil(
			viewModel.addLinksHelpURL,
			"a help href the client can't resolve (foreign scheme) is treated as absent"
		)
	}

	// MARK: - Mark as read

	/// A two-item queue whose `/queue/{id}/status` POST behaves per `statusStub`.
	private func markReadHandler(
		statusStub: @escaping (String) -> StubURLProtocol.Stub
	) -> (URLRequest, Data) -> StubURLProtocol.Stub {
		return { request, _ in
			let path = request.url?.path ?? ""
			if path.hasSuffix("/status") { return statusStub(path) }
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")],
					total: 2
				))
			default:
				return .json(404, "{}")
			}
		}
	}

	func testMarkAsReadOptimisticallyRemovesAndKeepsRemovedOnSuccess() async {
		StubURLProtocol.setHandler(markReadHandler { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])

		await viewModel.markAsRead(viewModel.articles[0])

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a2"],
			"the marked row is removed and the status POST never re-adds it"
		)
		XCTAssertNil(viewModel.errorText)
	}

	func testMarkAsReadRestoresRowOnServerError() async {
		StubURLProtocol.setHandler(markReadHandler { _ in
			.json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
		})
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		await viewModel.markAsRead(viewModel.articles[0])

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2"],
			"a failed mark-read rolls the optimistic removal back"
		)
		XCTAssertNotNil(viewModel.errorText)
	}

	func testRefusedMarkAsReadSurfacesServerMessages() async {
		StubURLProtocol.setHandler(markReadHandler { _ in
			.json(403, Fixtures.accountLockedError())
		})
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])

		await viewModel.markAsRead(viewModel.articles[0])

		XCTAssertEqual(viewModel.messages.first?.type, "warning")
		XCTAssertTrue(
			viewModel.messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false,
			"the refusal message names the address to email"
		)
		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2"],
			"a refused mark-read restores the optimistically-removed row"
		)
	}

	func testRemoveArticleDropsTheRowWithoutANetworkCall() async {
		StubURLProtocol.setHandler(markReadHandler { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		viewModel.removeArticle(id: "a1")

		XCTAssertEqual(viewModel.articles.map(\.id), ["a2"])
		XCTAssertTrue(StubURLProtocol.records(path: "/queue/a1/status").isEmpty, "removeArticle is local-only")
	}

	// MARK: - Reader

	private func article(readHref: String?, id: String = "a1") -> Article {
		Article(
			id: id, url: "https://example.com/x", title: "X", siteName: nil, excerpt: nil,
			imageURL: nil, readTimeMinutes: nil, isRead: false, savedAt: nil,
			updateStatusAction: nil, readHref: readHref
		)
	}

	func testOpenReaderPublishesPresentationWithResolvedURL() {
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		viewModel.openReader(for: article(readHref: "/queue/a1/view"))

		let presentation = viewModel.readerPresentation
		XCTAssertEqual(presentation?.articleId, "a1")
		XCTAssertEqual(presentation?.readerURL.absoluteString, "\(AppConfig.serverBaseURL)/queue/a1/view")
	}

	func testOpenReaderIsANoOpWhenArticleHasNoReadHref() {
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		viewModel.openReader(for: article(readHref: nil))

		XCTAssertNil(viewModel.readerPresentation, "a row with no read link is read-only")
	}

	func testOpenReaderIsANoOpForForeignSchemeReadHref() {
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		viewModel.openReader(for: article(readHref: "mailto:hi@example.com"))

		XCTAssertNil(viewModel.readerPresentation, "an href the client can't act on is treated as absent")
	}

	func testMintReaderSessionReturnsCookieOnSuccess() async {
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "hutch_sid=sess-xyz; Path=/; HttpOnly"])
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		let cookie = await viewModel.mintReaderSession()

		XCTAssertEqual(cookie?.name, "hutch_sid")
		XCTAssertEqual(cookie?.value, "sess-xyz")
		XCTAssertNil(viewModel.errorText)
	}

	func testMintReaderSessionReturnsNilAndSurfacesErrorOnFailure() async {
		StubURLProtocol.setHandler { _, _ in
			.json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		let cookie = await viewModel.mintReaderSession()

		XCTAssertNil(cookie, "a failed bootstrap mints no session, so the sheet shows its unavailable view")
		XCTAssertNotNil(viewModel.errorText)
	}
}
