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

	/// A locked account: the queue loads (so the `save-article` action is
	/// discovered) but every save POST is refused with a server-authored message.
	private func lockedAccountHandler() -> (URLRequest, Data) -> StubURLProtocol.Stub {
		return { request, _ in
			let path = request.url?.path ?? ""
			let method = request.httpMethod ?? "GET"
			switch (path, method) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", "POST"):
				return .json(403, Fixtures.accountLockedError())
			case ("/queue", _):
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
	}

	func testRefusedSaveSurfacesServerMessages() async {
		StubURLProtocol.setHandler(lockedAccountHandler())
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		await viewModel.saveURL("https://example.com/x")

		XCTAssertEqual(viewModel.messages.first?.type, "warning")
		XCTAssertEqual(viewModel.messages.first?.content.type, "text/html")
		XCTAssertTrue(
			viewModel.messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false,
			"the refusal message names the address to email"
		)
	}

	func testSuccessfulRefreshClearsStaleRefusalBanner() async {
		StubURLProtocol.setHandler(lockedAccountHandler())
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		await viewModel.saveURL("https://example.com/x")
		XCTAssertFalse(viewModel.messages.isEmpty, "precondition: a refused save shows the banner")

		await viewModel.refresh()

		XCTAssertTrue(
			viewModel.messages.isEmpty,
			"a locked account's reads still succeed, so a fresh load reconciles the stale banner"
		)
	}

	func testSaveResetsMessagesSoASucceedingSaveClearsTheBanner() async {
		var savePOSTs = 0
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			let method = request.httpMethod ?? "GET"
			switch (path, method) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", "POST"):
				savePOSTs += 1
				return savePOSTs == 1
					? .json(403, Fixtures.accountLockedError())
					: .json(201, Fixtures.article(id: "saved"))
			case ("/queue", _):
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		await viewModel.saveURL("https://example.com/x")
		XCTAssertFalse(viewModel.messages.isEmpty, "precondition: the first save is refused")

		await viewModel.saveURL("https://example.com/y")

		XCTAssertTrue(viewModel.messages.isEmpty, "saveURL resets messages before the next attempt")
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

	func testMarkAsReadKeepsRowRemovedOn404() async {
		StubURLProtocol.setHandler(markReadHandler { _ in .json(404, "{}") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		await viewModel.markAsRead(viewModel.articles[0])

		XCTAssertEqual(viewModel.articles.map(\.id), ["a2"], "a 404 means already gone; keep it removed")
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

	func testRemoveArticleDropsTheRowWithoutANetworkCall() async {
		StubURLProtocol.setHandler(markReadHandler { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		viewModel.removeArticle(id: "a1")

		XCTAssertEqual(viewModel.articles.map(\.id), ["a2"])
		XCTAssertTrue(StubURLProtocol.records(path: "/queue/a1/status").isEmpty, "removeArticle is local-only")
	}

	// MARK: - Reader

	/// A queue whose `POST /auth/session` mints the session cookie `prepareReader`
	/// needs. `sessionStub` lets a test model the bootstrap succeeding or failing.
	private func readerHandler(
		sessionStub: @escaping () -> StubURLProtocol.Stub
	) -> (URLRequest, Data) -> StubURLProtocol.Stub {
		return { request, _ in
			let path = request.url?.path ?? ""
			let method = request.httpMethod ?? "GET"
			switch (path, method) {
			case ("/auth/session", "POST"):
				return sessionStub()
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", _):
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
	}

	func testPrepareReaderPublishesPresentationWithCookieAndArticleId() async throws {
		StubURLProtocol.setHandler(readerHandler {
			StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "hutch_sid=sess-xyz; Path=/; HttpOnly"])
		})
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		let article = try XCTUnwrap(viewModel.articles.first)

		await viewModel.prepareReader(for: article)

		let presentation = try XCTUnwrap(viewModel.readerPresentation, "a prepared reader drives the sheet")
		XCTAssertEqual(presentation.articleId, "a1")
		XCTAssertEqual(presentation.readHref, "/queue/a1/view")
		XCTAssertEqual(presentation.cookie.name, "hutch_sid")
		XCTAssertEqual(presentation.cookie.value, "sess-xyz")
		XCTAssertNil(viewModel.errorText)
	}

	func testPrepareReaderFailsClosedWhenSessionBootstrapFails() async throws {
		StubURLProtocol.setHandler(readerHandler {
			.json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
		})
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		let article = try XCTUnwrap(viewModel.articles.first)

		await viewModel.prepareReader(for: article)

		XCTAssertNil(viewModel.readerPresentation, "a failed session bootstrap must not open the reader sheet")
		XCTAssertNotNil(viewModel.errorText)
	}

	func testPrepareReaderIsANoOpWhenArticleHasNoReadHref() async {
		StubURLProtocol.setHandler { _, _ in .json(404, "{}") }
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		let article = Article(
			id: "a1", url: "https://example.com/x", title: "X", siteName: nil, excerpt: nil,
			imageURL: nil, readTimeMinutes: nil, isRead: false, savedAt: nil,
			updateStatusAction: nil, readHref: nil
		)

		await viewModel.prepareReader(for: article)

		XCTAssertNil(viewModel.readerPresentation)
		XCTAssertTrue(
			StubURLProtocol.records(path: "/auth/session").isEmpty,
			"with no read href there is nothing to read, so no session is minted"
		)
	}
}
