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

	// MARK: - Add-links help (client-side)

	func testAddLinksHelpURLIsTheClientHeldHelpPath() {
		// The + control opens the help page at a path the client holds, resolved
		// against the API base — not a link discovered from the server — so it is
		// available before (and regardless of) any queue load.
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		XCTAssertEqual(
			viewModel.addLinksHelpURL?.absoluteString,
			"\(AppConfig.serverBaseURL)/help/add-links"
		)
	}

	/// A locked account: the queue loads, but invoking a collection action is refused
	/// with a server-authored message.
	private func lockedAccountHandler() -> (URLRequest, Data) -> StubURLProtocol.Stub {
		return { request, _ in
			let path = request.url?.path ?? ""
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue/purge":
				return .json(403, Fixtures.accountLockedError())
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
	}

	private let purgeAction = SirenAction(
		name: "purge-all", href: "/queue/purge", method: "POST", title: "Purge", type: nil, fields: nil
	)

	func testRefusedCollectionInvokeSurfacesServerMessages() async {
		StubURLProtocol.setHandler(lockedAccountHandler())
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		await viewModel.invokeCollection(purgeAction)

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
		await viewModel.invokeCollection(purgeAction)
		XCTAssertFalse(viewModel.messages.isEmpty, "precondition: a refused invoke shows the banner")

		await viewModel.refresh()

		XCTAssertTrue(
			viewModel.messages.isEmpty,
			"a locked account's reads still succeed, so a fresh load reconciles the stale banner"
		)
	}

	// MARK: - Save affordance gating

	func testToolbarSurfacesOnlyTheClientAddControlForADefaultCollection() async {
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		XCTAssertEqual(
			viewModel.collectionAffordances.map(\.token), ["add-links-help"],
			"the client-side + control is present before any response advertises affordances"
		)

		await viewModel.refresh()

		XCTAssertEqual(
			viewModel.collectionAffordances.map(\.token), ["add-links-help"],
			"the server's collection actions — save-article, the capture-only saves (save-html/save-content), and the field-requiring search — are all dropped client-side, leaving only the client + control"
		)
		XCTAssertFalse(
			viewModel.collectionAffordances.contains { $0.token == "save-article" },
			"the server-advertised save-article is ignored: saving a URL is a Share-Sheet capability, not a toolbar control"
		)
	}

	func testToolbarDropsSearchBecauseItIsNotInvokableByABareControl() async {
		// The real server advertises `search` with fields the user must fill and no
		// pre-filled value; iOS has no query UI for it, so the client must not surface
		// a control it cannot actually invoke (it would just open /queue in a webview).
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		XCTAssertFalse(
			viewModel.collectionAffordances.contains { $0.token == "search" },
			"a field-requiring action with no server value is not surfaced as a toolbar control"
		)
	}

	func testToolbarExcludesCaptureOnlySavesAndStructuralLinks() async {
		// A collection carrying a navigable `save` link, structural `prev`/`next`
		// pagination links, and the capture-only saves: only the controls the client
		// can present as toolbar buttons survive. The structural rels the client
		// follows itself for pagination/identity never become user controls.
		let extraLinks = """
			,{ "rel": ["save"], "href": "/save", "title": "Save a link" }
			,{ "rel": ["prev"], "href": "/queue?page=0" }
			,{ "rel": ["next"], "href": "/queue?page=2" }
			"""
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], extraLinks: extraLinks))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		XCTAssertEqual(
			viewModel.collectionAffordances.map(\.token),
			["save", "add-links-help"],
			"save-article, capture-only saves, the field-requiring search, and structural rels (self/root/prev/next) never render; a navigable save link does, and the client + control is always appended"
		)
	}

	func testToolbarRendersWhateverActionsTheServerOffers() async {
		// A server advertising only a single bare-invokable action still drives a
		// control — the loop never gates on whether a known save action is present.
		let futureOnly = """
		{ "name": "purge-all", "title": "Purge", "href": "/queue/purge", "method": "POST" }
		"""
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], actionsJSON: futureOnly))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		XCTAssertEqual(
			viewModel.collectionAffordances.compactMap(\.action).map(\.name), ["purge-all"],
			"a server offering an unknown bare-invokable action still renders its advertised controls"
		)
	}

	func testToolbarTracksTheCurrentResponsesAffordances() async {
		let futureOnly = """
		{ "name": "purge-all", "title": "Purge", "href": "/queue/purge", "method": "POST" }
		"""
		var queueGETs = 0
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				queueGETs += 1
				return queueGETs == 1
					? .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], actionsJSON: futureOnly))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		XCTAssertEqual(
			viewModel.collectionAffordances.map(\.token), ["add-links-help"],
			"precondition: the first collection advertises no toolbar-presentable server action, so only the client + control shows"
		)

		await viewModel.refresh()

		XCTAssertEqual(
			viewModel.collectionAffordances.compactMap(\.action).map(\.name), ["purge-all"],
			"the toolbar reflects the current response: a later collection's bare-invokable action renders alongside the client + control"
		)
	}

	func testLoadMoreRetainsTheFirstPageToolbarWhenAPaginatedPageAdvertisesNoActions() async throws {
		// A paginated (load-more) page only appends rows. When it advertises no
		// collection actions, the toolbar must neither clear nor flap to a page-scoped
		// set: the first page owns the toolbar for the whole scroll, so the controls
		// it discovered survive the load-more.
		let nextLink = """
			,{ "rel": ["next"], "href": "/queue?page=2" }
			"""
		StubURLProtocol.setHandler { request, _ in
			let url = request.url
			switch (url?.path, url?.query) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", let query) where query?.contains("page=2") == true:
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a2")], page: 2, actionsJSON: ""))
			case ("/queue", _):
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], extraLinks: nextLink))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		let firstPageToolbar = viewModel.collectionAffordances.map(\.token)
		XCTAssertFalse(firstPageToolbar.isEmpty, "precondition: the first-page load owns a toolbar (the client + control)")

		await viewModel.loadMore()

		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"], "the second page's rows are appended")
		XCTAssertEqual(
			viewModel.collectionAffordances.map(\.token), firstPageToolbar,
			"an actionless paginated page leaves the first-page toolbar in place — it does not clear it"
		)
	}

	func testInvokeCollectionSubmitsTheActionAndReloadsFromTheServer() async throws {
		// A bare-invokable collection action is submitted through the generic invoker
		// (honouring its own href/method) — not opened as a GET web view of its href —
		// then the collection is reloaded so the server's new state replaces the old.
		var queueGETs = 0
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			let method = request.httpMethod ?? "GET"
			switch (path, method) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue/purge", "POST"):
				return .redirect(to: "/queue")
			case ("/queue", _):
				queueGETs += 1
				return queueGETs == 1
					? .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
					: .json(200, Fixtures.collection(entitiesJSON: []))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1"])

		let purge = SirenAction(name: "purge-all", href: "/queue/purge", method: "POST", title: "Purge", type: nil, fields: nil)
		await viewModel.invokeCollection(purge)

		XCTAssertEqual(StubURLProtocol.records(path: "/queue/purge").first?.request.httpMethod, "POST")
		XCTAssertTrue(viewModel.articles.isEmpty, "the reload reflects the server's post-invoke state")
		XCTAssertNil(viewModel.readerPresentation, "an action is invoked, never opened in the web view")
		XCTAssertNil(viewModel.errorText)
	}

	func testInvokeCollectionSurfacesAServerErrorAndLeavesTheListInPlace() async {
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue/purge":
				return .json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		let purge = SirenAction(name: "purge-all", href: "/queue/purge", method: "POST", title: "Purge", type: nil, fields: nil)
		await viewModel.invokeCollection(purge)

		XCTAssertEqual(viewModel.articles.map(\.id), ["a1"], "a failed collection invoke leaves the current list")
		XCTAssertNotNil(viewModel.errorText)
	}

	func testOpenLinkPublishesAWebSheetWithNoRowAttached() {
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		viewModel.open(link: SirenLink(rel: ["save"], href: "/save", title: "Save a link"))

		let presentation = viewModel.readerPresentation
		XCTAssertEqual(presentation?.readerURL.absoluteString, "\(AppConfig.serverBaseURL)/save")
		XCTAssertNil(presentation?.articleId, "a navigable collection link is not tied to a row")
	}

	func testOpenLinkIsANoOpForAForeignSchemeHref() {
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		viewModel.open(link: SirenLink(rel: ["save"], href: "mailto:hi@example.com", title: nil))

		XCTAssertNil(viewModel.readerPresentation, "an href the client can't resolve never opens a blank sheet")
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

	/// The `update-status` action the server advertised on a row, looked up by
	/// iterating its affordances — the same path the view does — so the test
	/// invokes the action the loop would render rather than a hand-built one.
	private func updateStatusAction(of article: Article) throws -> SirenAction {
		try XCTUnwrap(article.affordances.first { $0.token == "update-status" }?.action)
	}

	func testInvokeUpdateStatusOptimisticallyRemovesAndKeepsRemovedOnSuccess() async throws {
		StubURLProtocol.setHandler(markReadHandler { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])

		let target = viewModel.articles[0]
		await viewModel.invoke(try updateStatusAction(of: target), on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a2"],
			"the marked row is removed and the status POST never re-adds it"
		)
		XCTAssertNil(viewModel.errorText)
	}

	func testInvokeUpdateStatusKeepsTheRowWhenItTogglesBackToUnread() async throws {
		// A read item's update-status toggles to "unread", which stays in the
		// unread-only list, so the row must not be dropped — the next load reconciles.
		let readArticle = """
			{ "class": ["article"], "rel": ["item"],
			  "properties": { "id": "a1", "url": "https://example.com/x", "status": "read" },
			  "links": [{ "rel": ["read"], "href": "/queue/a1/view" }],
			  "actions": [
			    { "name": "update-status", "href": "/queue/a1/status", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "status", "type": "text", "value": "unread" }] }
			  ] }
			"""
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			if path.hasSuffix("/status") { return .redirect(to: "/queue") }
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [readArticle]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1"])

		let target = viewModel.articles[0]
		await viewModel.invoke(try updateStatusAction(of: target), on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1"],
			"a toggle back to unread leaves the row in the unread-only list"
		)
		XCTAssertNil(viewModel.errorText)
	}

	func testInvokeSendsTheStatusFieldForUpdateStatus() async throws {
		StubURLProtocol.setHandler(markReadHandler { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		let target = viewModel.articles[0]
		await viewModel.invoke(try updateStatusAction(of: target), on: target)

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue/a1/status").first)
		XCTAssertEqual(
			TestSupport.formFields(record.body)["status"], "read",
			"update-status carries the protocol-fixed status field, set to read"
		)
	}

	func testInvokeRestoresRowOnServerError() async throws {
		StubURLProtocol.setHandler(markReadHandler { _ in
			.json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
		})
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		let target = viewModel.articles[0]
		await viewModel.invoke(try updateStatusAction(of: target), on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2"],
			"a failed invocation rolls the optimistic removal back"
		)
		XCTAssertNotNil(viewModel.errorText)
	}

	func testInvokeDeleteOptimisticallyRemovesTheItem() async throws {
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			if path.hasSuffix("/delete") { return .redirect(to: "/queue") }
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")], total: 2
				))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		let target = viewModel.articles[0]
		let deleteAction = try XCTUnwrap(target.affordances.first { $0.token == "delete" }?.action)
		await viewModel.invoke(deleteAction, on: target)

		XCTAssertEqual(viewModel.articles.map(\.id), ["a2"], "delete removes the item it acts on")
	}

	func testInvokeNonRemovingActionLeavesTheListUntouched() async throws {
		// A non-removing action must not blanket-remove the row; per 'State Lives in
		// the Network' the list is left for the next load to reconcile.
		let viewAction = """
			{ "name": "view-original", "title": "Open original", "href": "/queue/a1/original", "method": "GET" }
			"""
		let articleWithView = """
			{ "class": ["article"], "properties": { "id": "a1", "url": "https://example.com/x" },
			  "actions": [\(viewAction)] }
			"""
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [articleWithView]))
			case "/queue/a1/original":
				return .redirect(to: "/queue")
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1"])

		let target = viewModel.articles[0]
		let action = try XCTUnwrap(target.affordances.first { $0.token == "view-original" }?.action)
		await viewModel.invoke(action, on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1"],
			"a non-removing action does not drop the row — only delete/update-status do"
		)
		XCTAssertNil(viewModel.errorText)
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
			actions: [], readHref: readHref
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
