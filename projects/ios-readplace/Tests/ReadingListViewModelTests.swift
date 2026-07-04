import XCTest
@testable import Readplace

@MainActor
final class ReadingListViewModelTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeViewModel(
		store: TokenStore,
		onSessionExpired: @escaping () -> Void = {}
	) -> ReadingListViewModel {
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL,
			store: store,
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
		return ReadingListViewModel(api: api, onSessionExpired: onSessionExpired)
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

	func testToolbarKeepsExactlyOneAddControlWhenTheServerAlsoAdvertisesAddLinksHelp() async {
		// The + is now client-owned and always injected. Should the server ever
		// re-advertise add-links-help (a rollback of the server change, or another
		// surface re-adding it), the client drops the server's same-token affordance so
		// the toolbar renders exactly one + — the client's canonical one — never a
		// duplicate. The server's advertised href differs so the survivor is identifiable.
		let serverAddLinksHelp = """
			,{ "rel": ["add-links-help"], "href": "/help/legacy-add-links", "title": "Old help" }
			"""
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")], extraLinks: serverAddLinksHelp))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		let addControls = viewModel.collectionAffordances.filter { $0.token == "add-links-help" }
		XCTAssertEqual(
			addControls.count, 1,
			"a server-advertised add-links-help is de-duped against the client-injected + — exactly one renders, never a duplicate"
		)
		XCTAssertEqual(
			addControls.first?.link?.href, AppConfig.addLinksHelpPath,
			"the surviving + is the client's canonical control (its own help path), not the server's advertised href"
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

	func testInvokeCollectionFallsBackToAFreshLoadWhenTheResponseIsNoCollection() async {
		// A collection action whose 2xx response is not a Siren collection (a 204, or
		// a redirect to an HTML confirmation) carries no collection to adopt, so the
		// view model re-lists from the entry point to reflect the new server state.
		var queueGETs = 0
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue/purge":
				return StubURLProtocol.Stub(status: 204)
			case "/queue":
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

		XCTAssertEqual(queueGETs, 2, "with no collection to adopt, the invoke falls back to a fresh first-page load")
		XCTAssertTrue(viewModel.articles.isEmpty, "the fallback reload reflects the server's post-invoke state")
		XCTAssertNil(viewModel.errorText)
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
	/// The first collection GET serves the two rows; when `laterQueue` is given,
	/// every subsequent collection GET serves it instead — the post-action truth a
	/// followed redirect (or a convergence load) returns.
	private func markReadHandler(
		laterQueue: String? = nil,
		statusStub: @escaping (String) -> StubURLProtocol.Stub
	) -> (URLRequest, Data) -> StubURLProtocol.Stub {
		var queueGETs = 0
		return { request, _ in
			let path = request.url?.path ?? ""
			if path.hasSuffix("/status") { return statusStub(path) }
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				queueGETs += 1
				if queueGETs > 1, let laterQueue { return .json(200, laterQueue) }
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

	func testInvokeUpdateStatusAdoptsTheServersPostActionCollection() async throws {
		// The status POST redirects back to the collection; that followed body is
		// the post-action truth and replaces the list — the marked row is gone and
		// an item marked unread on the website (w1) appears without a refresh.
		let postAction = Fixtures.collection(
			entitiesJSON: [Fixtures.article(id: "a2"), Fixtures.article(id: "w1")], total: 2
		)
		StubURLProtocol.setHandler(markReadHandler(laterQueue: postAction) { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])

		let target = viewModel.articles[0]
		await viewModel.invoke(try updateStatusAction(of: target), on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a2", "w1"],
			"the followed collection is adopted: the marked row is gone and a website-side unread item appears"
		)
		XCTAssertNil(viewModel.errorText)
	}

	func testInvokeOnADeepScrolledListDropsTheRowLocallyAndHoldsPosition() async throws {
		// Acting on a row after paginating must neither collapse the list to page 1
		// (yanking the reader to the top) nor splice a fresh server head above the
		// viewport (shifting it). A deep-scrolled list stays exactly where it is: only
		// the acted row is dropped, and the server's post-action collection — served
		// here as a sentinel [zzz] the client must NOT adopt — is ignored until the
		// next pull-to-refresh.
		let nextLink = """
			,{ "rel": ["next"], "href": "/queue?page=2" }
			"""
		var page1GETs = 0
		StubURLProtocol.setHandler { request, _ in
			let url = request.url
			if url?.path.hasSuffix("/status") == true { return .redirect(to: "/queue") }
			switch (url?.path, url?.query) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", let query) where query?.contains("page=2") == true:
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a3"), Fixtures.article(id: "a4")], page: 2
				))
			case ("/queue", _):
				page1GETs += 1
				return page1GETs == 1
					? .json(200, Fixtures.collection(
						entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")],
						extraLinks: nextLink
					))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "zzz")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		await viewModel.loadMore()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2", "a3", "a4"], "precondition: two pages are loaded")

		let target = viewModel.articles[2]
		await viewModel.invoke(try updateStatusAction(of: target), on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2", "a4"],
			"only the acted row is dropped; the list holds position and does not adopt the server's [zzz] collection while deep-scrolled"
		)
		XCTAssertNil(viewModel.errorText)
	}

	func testHandleForegroundOnADeepScrolledListHoldsPositionWithoutReloading() async throws {
		// Returning to the foreground while deep-scrolled must not re-read the list —
		// that would collapse it to page 1 and lose the user's position. The
		// convergence no-ops (no extra GET), leaving the paginated list intact.
		let nextLink = """
			,{ "rel": ["next"], "href": "/queue?page=2" }
			"""
		var page1GETs = 0
		StubURLProtocol.setHandler { request, _ in
			let url = request.url
			switch (url?.path, url?.query) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", let query) where query?.contains("page=2") == true:
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a3"), Fixtures.article(id: "a4")], page: 2
				))
			case ("/queue", _):
				page1GETs += 1
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")], extraLinks: nextLink
				))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		await viewModel.loadMore()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2", "a3", "a4"], "precondition: two pages are loaded")

		await viewModel.handleForeground()

		XCTAssertEqual(page1GETs, 1, "a deep-scrolled foreground does not re-read the first page")
		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2", "a3", "a4"],
			"the paginated list is held in place — reconciliation waits for a pull-to-refresh"
		)
	}

	func testInvokeUpdateStatusKeepsTheRowWhenItTogglesBackToUnread() async throws {
		// A read item's update-status toggles to "unread", which stays in the
		// unread-only list — and the adopted post-action collection still carries
		// the row, so it stays in place.
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

	func testInvokeLeavesTheListInPlaceOnServerError() async throws {
		StubURLProtocol.setHandler(markReadHandler { _ in
			.json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
		})
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		let target = viewModel.articles[0]
		await viewModel.invoke(try updateStatusAction(of: target), on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2"],
			"a failed invocation leaves the current list in place — nothing was dropped ahead of the server"
		)
		XCTAssertNotNil(viewModel.errorText)
	}

	func testInvokeDeleteAdoptsTheServersPostActionCollection() async throws {
		var queueGETs = 0
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			if path.hasSuffix("/delete") { return .redirect(to: "/queue") }
			switch path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				queueGETs += 1
				return queueGETs == 1
					? .json(200, Fixtures.collection(
						entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")], total: 2
					))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a2")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		let target = viewModel.articles[0]
		let deleteAction = try XCTUnwrap(target.affordances.first { $0.token == "delete" }?.action)
		await viewModel.invoke(deleteAction, on: target)

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a2"],
			"the deleted item is gone from the adopted post-action collection"
		)
	}

	func testInvokeDropsTheActedRowWhenTheResponseIsNoCollection() async throws {
		// A removing action (delete) whose 2xx response is not a Siren collection —
		// a 204, or a redirect to an HTML page — carries no re-list direction, so
		// api.invoke returns nil. The acted row must still drop locally, honouring
		// the removal the server already confirmed with its 2xx.
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			if path.hasSuffix("/delete") {
				return StubURLProtocol.Stub(
					status: 200, headers: ["Content-Type": "text/html"], body: Data("<!doctype html>".utf8)
				)
			}
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

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a2"],
			"the confirmed removal is applied locally even when the response carries no collection to adopt"
		)
		XCTAssertNil(viewModel.errorText)
	}

	func testInvokeNonRemovingActionLeavesTheListUntouched() async throws {
		// A response that is no collection carries no re-list direction, so the
		// list stays as it is for the next load to reconcile.
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
				return StubURLProtocol.Stub(
					status: 200,
					headers: ["Content-Type": "text/html"],
					body: Data("<!doctype html>".utf8)
				)
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
			"a non-removing action whose response is no collection leaves the row in place"
		)
		XCTAssertNil(viewModel.errorText)
	}

	func testReaderStatusChangedConvergesWithTheServerWithoutInferringDirection() async {
		// The reader's own POST already happened inside the webview, but the client
		// can't see which direction the toggle went, so it does not infer "read" and
		// drop a row — it re-reads the collection and adopts the server's truth, which
		// no longer lists the read item (a1) and brings in an item marked unread on
		// the website (w1).
		let postAction = Fixtures.collection(
			entitiesJSON: [Fixtures.article(id: "a2"), Fixtures.article(id: "w1")], total: 2
		)
		StubURLProtocol.setHandler(markReadHandler(laterQueue: postAction) { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		await viewModel.readerStatusChanged()

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a2", "w1"],
			"the server's re-read collection is adopted as truth; no row is dropped by inference"
		)
		XCTAssertTrue(
			StubURLProtocol.records.allSatisfy { $0.request.httpMethod != "POST" },
			"the reader already posted inside the webview; the app itself issues no POST — only the convergence GET"
		)
	}

	// MARK: - Foreground refresh

	func testHandleForegroundConvergesTheLoadedListWithTheServer() async {
		let postForeground = Fixtures.collection(
			entitiesJSON: [
				Fixtures.article(id: "a1"), Fixtures.article(id: "a2"), Fixtures.article(id: "w1"),
			],
			total: 3
		)
		StubURLProtocol.setHandler(markReadHandler(laterQueue: postForeground) { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])

		await viewModel.handleForeground()

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2", "w1"],
			"returning to the foreground re-reads the list, so a website-side change appears without pull-to-refresh"
		)
	}

	func testHandleForegroundBeforeTheFirstLoadIsANoOp() async {
		StubURLProtocol.setHandler(markReadHandler { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.handleForeground()

		XCTAssertTrue(
			StubURLProtocol.records.isEmpty,
			"at launch the initial load owns the fetch — the foreground hook does not race it with a second one"
		)
		XCTAssertTrue(viewModel.articles.isEmpty)
	}

	// MARK: - Web sheet dismissal

	/// A two-page queue behind a flippable "account deleted" switch: once flipped,
	/// the server behaves as `POST /account/delete` leaves it — every authenticated
	/// call 401s and the token refresh is rejected (all sessions destroyed, all
	/// OAuth tokens revoked).
	private func deletableAccountHandler(
		accountDeleted: @escaping () -> Bool
	) -> (URLRequest, Data) -> StubURLProtocol.Stub {
		let nextLink = """
			,{ "rel": ["next"], "href": "/queue?page=2" }
			"""
		return { request, _ in
			let url = request.url
			if accountDeleted() {
				return url?.path == "/oauth/token" ? .json(400, "{}") : .json(401, "{}")
			}
			switch (url?.path, url?.query) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", let query) where query?.contains("page=2") == true:
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a3"), Fixtures.article(id: "a4")], page: 2
				))
			case ("/queue", _):
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")], extraLinks: nextLink
				))
			default:
				return .json(404, "{}")
			}
		}
	}

	func testWebSheetDismissalOnADeletedAccountFunnelsIntoOnSessionExpired() async {
		// The user confirmed the account deletion inside the web sheet. Closing the
		// sheet must discover the dead session immediately — even deep-scrolled,
		// where the foreground converge is zero-network — and funnel into the
		// existing onSessionExpired sign-out, rather than leaving the deleted
		// account's cached list looking signed-in for the rest of the process.
		var accountDeleted = false
		StubURLProtocol.setHandler(deletableAccountHandler(accountDeleted: { accountDeleted }))
		var sessionExpired = false
		let viewModel = makeViewModel(
			store: TestSupport.loggedInStore(),
			onSessionExpired: { sessionExpired = true }
		)
		await viewModel.refresh()
		await viewModel.loadMore()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2", "a3", "a4"], "precondition: two pages are loaded")

		accountDeleted = true
		await viewModel.handleWebSheetDismissal()

		XCTAssertTrue(
			sessionExpired,
			"the dismissal probe 401s against the deleted account, the refresh is rejected, and the failure reuses the existing onSessionExpired → forceLogout path"
		)
		XCTAssertEqual(
			StubURLProtocol.records(path: "/oauth/token").count, 1,
			"the probe went through the normal 401 plumbing: one refresh attempt, rejected because deletion revoked the tokens"
		)
	}

	func testWebSheetDismissalOnADeepScrolledListProbesTheServerAndHoldsPosition() async {
		// Unlike the foreground converge — zero-network once the list has paginated —
		// the dismissal re-read must actually reach the server: it exists to discover
		// a session the sheet's own page just killed. A live session's deep-scrolled
		// list still holds its position: the fetched page (a sentinel [zzz] the
		// client must not adopt) is discarded, so the probe never yanks the viewport.
		let nextLink = """
			,{ "rel": ["next"], "href": "/queue?page=2" }
			"""
		var page1GETs = 0
		StubURLProtocol.setHandler { request, _ in
			let url = request.url
			switch (url?.path, url?.query) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", let query) where query?.contains("page=2") == true:
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a3"), Fixtures.article(id: "a4")], page: 2
				))
			case ("/queue", _):
				page1GETs += 1
				return page1GETs == 1
					? .json(200, Fixtures.collection(
						entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")], extraLinks: nextLink
					))
					: .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "zzz")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		await viewModel.loadMore()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2", "a3", "a4"], "precondition: two pages are loaded")

		await viewModel.handleWebSheetDismissal()

		XCTAssertEqual(page1GETs, 2, "the dismissal probe hits the network even when deep-scrolled")
		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2", "a3", "a4"],
			"a live session's paginated list holds its position — the probe's body is discarded, not adopted"
		)
	}

	func testWebSheetDismissalOnAShallowListConvergesWithTheServer() async {
		// Closing the web sheet near the top adopts the fresh first page, so a
		// change the sheet's own page made (an item saved via the /save page, s1)
		// appears immediately — the probe doubles as the foreground reconciliation.
		let postDismissal = Fixtures.collection(
			entitiesJSON: [
				Fixtures.article(id: "a1"), Fixtures.article(id: "a2"), Fixtures.article(id: "s1"),
			],
			total: 3
		)
		StubURLProtocol.setHandler(markReadHandler(laterQueue: postDismissal) { _ in .redirect(to: "/queue") })
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()
		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])

		await viewModel.handleWebSheetDismissal()

		XCTAssertEqual(
			viewModel.articles.map(\.id), ["a1", "a2", "s1"],
			"a shallow list adopts the post-dismissal server truth, so a change made inside the sheet shows without pull-to-refresh"
		)
	}

	// MARK: - Reader

	private func article(readHref: String?, id: String = "a1") -> Article {
		Article(
			id: id, url: "https://example.com/x", title: "X", siteName: nil, excerpt: nil,
			imageURL: nil, readTimeMinutes: nil, isRead: false, savedAt: nil,
			actions: [], links: [], readHref: readHref
		)
	}

	func testOpenReaderPublishesPresentationWithResolvedURLAndPlatformParam() {
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		viewModel.openReader(for: article(readHref: "/queue/a1/view"))

		let presentation = viewModel.readerPresentation
		XCTAssertEqual(presentation?.articleId, "a1")
		XCTAssertEqual(
			presentation?.readerURL.absoluteString,
			"\(AppConfig.serverBaseURL)/queue/a1/view?platform=ios",
			"the app appends ?platform=ios so the server renders the reader chromeless in the webview"
		)
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

		let cookies = await viewModel.mintReaderSession()

		XCTAssertEqual(cookies?.first?.value, "sess-xyz")
		XCTAssertNil(viewModel.errorText)
	}

	func testMintReaderSessionReturnsNilAndSurfacesErrorOnFailure() async {
		StubURLProtocol.setHandler { _, _ in
			.json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		let cookies = await viewModel.mintReaderSession()

		XCTAssertNil(cookies, "a failed bootstrap mints no session, so the sheet shows its unavailable view")
		XCTAssertNotNil(viewModel.errorText)
	}

	// MARK: - Session expiry & warnings

	func testUnauthorizedLoadLogsOutWithoutAnErrorBanner() async {
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL,
			store: TestSupport.loggedInStore(),
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
		var expired = false
		let viewModel = ReadingListViewModel(api: api, onSessionExpired: { expired = true })
		// 401 everywhere: the entry-point load 401s, the single refresh 401s, and
		// the load surfaces .unauthorized.
		StubURLProtocol.setHandler { _, _ in .json(401, "{}") }

		await viewModel.refresh()

		XCTAssertTrue(expired, "a 401 whose refresh also fails logs the user out")
		XCTAssertNil(viewModel.errorText, "a session-expiry logout is not shown as an error banner")
	}

	func testCollectionWarningPopulatesWarningText() async {
		let warnedQueue = """
		{
		  "class": ["collection", "articles"],
		  "properties": { "total": 1, "page": 1, "pageSize": 20, "warning": { "code": "not-saveable", "message": "Cannot save that link." } },
		  "entities": [\(Fixtures.article(id: "a1"))],
		  "links": [{ "rel": ["self"], "href": "/queue" }, { "rel": ["root"], "href": "/queue" }],
		  "actions": []
		}
		"""
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/" ? .redirect(to: "/queue") : .json(200, warnedQueue)
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()

		XCTAssertEqual(viewModel.warningText, "Cannot save that link.")
	}

	func testMintReaderSessionFollowsTheServersCreateSessionAction() async {
		let queueWithSession = """
		{
		  "class": ["collection", "articles"],
		  "properties": { "total": 1, "page": 1, "pageSize": 20 },
		  "entities": [\(Fixtures.article(id: "a1"))],
		  "links": [{ "rel": ["self"], "href": "/queue" }, { "rel": ["root"], "href": "/queue" }],
		  "actions": [{ "name": "create-session", "href": "/custom/session", "method": "POST" }]
		}
		"""
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/": return .redirect(to: "/queue")
			case "/queue": return .json(200, queueWithSession)
			case "/custom/session": return StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "sess=v; Path=/"])
			default: return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())
		await viewModel.refresh()

		let cookies = await viewModel.mintReaderSession()

		XCTAssertEqual(cookies?.first?.value, "v")
		XCTAssertTrue(
			StubURLProtocol.records.contains { $0.request.url?.path == "/custom/session" },
			"the reader session mint follows the discovered create-session action, not a hard-coded route"
		)
	}
}
