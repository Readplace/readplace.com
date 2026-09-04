import Foundation

@MainActor
final class ReadingListViewModel: ObservableObject {
	@Published private(set) var articles: [Article] = []
	@Published private(set) var isLoading = false
	@Published private(set) var hasMore = false
	@Published var errorText: String?
	@Published var warningText: String?
	/// Server-authored messages surfaced to the UI (e.g. a locked-account refusal),
	/// rendered generically — the client owns no per-feature knowledge of them.
	@Published var messages: [ServerMessage] = []
	/// Set when a readable row is tapped, or when a navigable collection link is
	/// invoked; drives the reader/web sheet. The session cookie is minted inside
	/// the sheet, so the sheet opens without waiting.
	@Published var readerPresentation: ReaderPresentation?
	/// The "add links via Share" help page the reading list's + control opens in a
	/// webview. A client-owned path resolved against the API base — the client holds
	/// it itself rather than reading it from the server's add-links-help link — so the
	/// + control works before (and regardless of) a readlist load. It carries the
	/// app-shell marker so the server renders the page chromeless with a "← Back to
	/// readlist" deep link, the same way the account page does inside this sheet.
	let addLinksHelpURL: URL?

	/// The collection-level controls the toolbar renders. The server's own collection
	/// affordances are looped (each presentable one becomes a control), and the
	/// client-side add (+) control that opens the Share help is always present — it is
	/// injected by the client and kept canonical, so any add-links-help the server
	/// also advertises is deduped rather than rendered as a second +.
	@Published private(set) var collectionAffordances: [Affordance] = [ReadingListViewModel.addLinksHelp]
	@Published private(set) var tabs: [ReadlistTab] = []
	@Published private(set) var selectedTabHref: String?
	@Published private(set) var appearance: String?

	private var nextHref: String?
	private var currentTabHref: String?
	private var tabGeneration = 0
	private var readsStarted = 0
	private var readApplied = 0
	private var readsInFlight = 0 {
		didSet { isLoading = readsInFlight > 0 }
	}
	/// The server-advertised `create-session` action from the loaded collection,
	/// followed to mint the reader's browser session. Nil against a server that
	/// hasn't advertised it, in which case the API falls back to a fixed path.
	private var sessionAction: SirenAction?
	private var isLoadingMore = false
	private var isDrainingUploads = false
	private var pagesHeld = 0
	/// Whether a collection has ever been applied. Gates the foreground refresh so
	/// it never races the initial `.task` load with a second fetch at launch.
	private var hasLoadedOnce = false

	private let api: ReadplaceAPI
	private let jobs: UploadJobStore?
	private let unseenSave: UnseenSave?
	private let onSessionExpired: () -> Void

	/// The reading list's client-side add (+) control: a navigable `add-links-help`
	/// affordance the client injects itself rather than discovering from the server.
	/// Tapping it opens the native Share-help sheet (`ToolbarRoute.presentAddLinksHelp`);
	/// the client ignores any add-links-help the server advertises and treats this one
	/// as canonical, so the toolbar's add control is owned entirely by the client.
	/// Built from constant inputs, so it always constructs.
	private static let addLinksHelp: Affordance = {
		let link = SirenLink(rel: ["add-links-help"], href: AppConfig.addLinksHelpPath, title: "How to add links")
		guard let affordance = Affordance(link: link) else {
			preconditionFailure("the client add-links-help affordance is built from constant inputs and must construct")
		}
		return affordance
	}()

	init(api: ReadplaceAPI, jobs: UploadJobStore?, unseenSave: UnseenSave?, onSessionExpired: @escaping () -> Void) {
		self.api = api
		self.jobs = jobs
		self.unseenSave = unseenSave
		self.onSessionExpired = onSessionExpired
		// Append the same app-shell marker `open(link:)` puts on the account href, so
		// the help page is served chromeless with a deep-link back to the native list.
		// A URL that can't take the marker resolves to nil — the + control then shows
		// its native fallback rather than opening a marker-less page.
		addLinksHelpURL = Href.resolve(AppConfig.addLinksHelpPath, baseURL: api.baseURL)
			.flatMap { Href.appending(AppConfig.appShellQueryItem, to: $0) }
	}

	func loadIfNeeded() async {
		guard articles.isEmpty else { return }
		await fetchFirstPage()
	}

	func refresh() async {
		await fetchFirstPage()
	}

	func select(tabHref: String) async {
		guard tabHref != currentTabHref else { return }
		tabGeneration += 1
		currentTabHref = tabHref
		selectedTabHref = tabHref
		articles = []
		nextHref = nil
		hasMore = false
		pagesHeld = 0
		isLoadingMore = false
		await fetchFirstPage()
	}

	private func tabUnchanged(since generation: Int) -> Bool {
		generation == tabGeneration
	}

	private func beginRead() -> Int {
		readsStarted += 1
		readsInFlight += 1
		return readsStarted
	}

	private func endRead() {
		readsInFlight -= 1
	}

	private func fetchFirstPage() async {
		let generation = tabGeneration
		let read = beginRead()
		defer { endRead() }
		errorText = nil
		// A locked account's reads still succeed, so a fresh load reconciles a
		// stale refusal banner (e.g. after verifying elsewhere): clear it here,
		// then re-surface it only if a later write (e.g. mark-as-read) is refused.
		messages = []
		do {
			let page = try await api.loadReadlist(path: currentTabHref)
			guard tabUnchanged(since: generation) else { return }
			replace(with: page, deeperPages: [], read: read)
		} catch {
			guard tabUnchanged(since: generation) else { return }
			handle(error)
		}
	}

	func loadMore() async {
		guard let next = nextHref, !isLoadingMore else { return }
		let generation = tabGeneration
		let listVersion = readApplied
		isLoadingMore = true
		do {
			let page = try await api.loadReadlist(path: next)
			if tabUnchanged(since: generation), listVersion == readApplied { apply(page, replacing: false) }
		} catch {
			if tabUnchanged(since: generation) { handle(error) }
		}
		if tabUnchanged(since: generation) { isLoadingMore = false }
	}

	/// Invokes an advertised action via the action's own href/method/type/fields
	/// through the generic invoker. The client supplies no field knowledge: every
	/// declared field's server-suggested `value` is posted, so a bare invocation is
	/// sufficient — `update-status` carries its target status as the field `value`,
	/// not a client constant. On success the list converges to whatever collection
	/// the server drove the invoke back to — the post-action truth, carrying changes
	/// made elsewhere (an item marked unread on the website appears right here). A
	/// failure surfaces the error and leaves the current list in place; there is no
	/// optimistic removal to roll back.
	func invoke(_ action: SirenAction) async {
		let generation = tabGeneration
		let read = beginRead()
		defer { endRead() }
		do {
			let page = try await api.invoke(action: action)
			guard tabUnchanged(since: generation) else { return }
			await adopt(page, read: read)
		} catch {
			handle(error)
		}
	}

	/// Reconciles the list after the reader reports a status change from inside the
	/// webview. The reader's own POST answers where no Siren body is available and
	/// the client cannot see which direction the toggle went, so it does not infer
	/// "read" and drop a row — it re-reads the collection and adopts the server's
	/// truth, which also brings in whatever changed elsewhere (e.g. an item marked
	/// unread on the website).
	func readerStatusChanged() async {
		await reloadAndAdopt()
	}

	/// Re-reads the list when the app returns to the foreground, so changes made
	/// while away — a share-sheet save, an item marked unread on the website —
	/// appear without pull-to-refresh. Gated on a completed first load: at launch
	/// the `.task` load owns the fetch and this is a no-op. A deep-scrolled list
	/// is re-read only when the share extension has recorded a save the list has
	/// not shown — the one change worth the same first-page reset (and viewport
	/// yank) a pull-to-refresh performs; every other deep-scrolled return stays
	/// zero-network and holds the reader's position.
	func handleForeground() async {
		guard hasLoadedOnce, !isLoading else { return }
		if pagesHeld > 1 {
			guard unseenSave?.exists == true, !isLoadingMore else { return }
			await refresh()
		} else {
			await reloadAndAdopt()
		}
	}

	/// Probes the server when the in-app web sheet closes, so a session the
	/// sheet's own page just killed is discovered immediately. The sheet can host
	/// the account page, whose delete-account flow destroys every session and
	/// revokes every OAuth token server-side, and nothing else fires promptly
	/// after that: the scene never leaves `.active` for an in-app sheet, and the
	/// foreground converge is zero-network for a paginated list with no pending
	/// share-sheet save — so without this probe the app would keep showing the
	/// deleted account's cached list until some later call happened to 401. The
	/// probe therefore always hits the network (no pagination gate, unlike the
	/// foreground re-read): against a dead session it 401s, the refresh fails on
	/// the revoked token, and the failure funnels into the existing
	/// `onSessionExpired` sign-out — clearing the TokenStore and the cached UI. A
	/// live session pays a re-read, which doubles as the same reconciliation the
	/// foreground performs.
	func handleWebSheetDismissal() async {
		await reloadAndAdopt()
	}

	private func adopt(_ page: ReadlistPage?, read: Int) async {
		guard let page else { return await reloadAndAdopt() }
		await adopt(firstPage: page, read: read)
	}

	private func adopt(firstPage: ReadlistPage, read: Int) async {
		let generation = tabGeneration
		var deeperPages: [ReadlistPage] = []
		var hopFailure: Error?
		while deeperPages.count + 1 < pagesHeld, let next = (deeperPages.last ?? firstPage).nextHref {
			do {
				let page = try await api.loadReadlist(path: next)
				guard tabUnchanged(since: generation) else { return }
				deeperPages.append(page)
			} catch {
				guard tabUnchanged(since: generation) else { return }
				hopFailure = error
				break
			}
		}
		guard replace(with: firstPage, deeperPages: deeperPages, read: read) else { return }
		if let hopFailure { handle(hopFailure) }
	}

	@discardableResult
	private func replace(with firstPage: ReadlistPage, deeperPages: [ReadlistPage], read: Int) -> Bool {
		guard read > readApplied else { return false }
		readApplied = read
		apply(firstPage, replacing: true)
		for page in deeperPages { apply(page, replacing: false) }
		return true
	}

	private func reloadAndAdopt() async {
		let generation = tabGeneration
		let read = beginRead()
		defer { endRead() }
		do {
			let page = try await api.loadReadlist(path: currentTabHref)
			guard tabUnchanged(since: generation) else { return }
			await adopt(firstPage: page, read: read)
		} catch {
			guard tabUnchanged(since: generation) else { return }
			handle(error)
		}
	}

	/// Opens the reader for a tapped row. A row whose server response carries no
	/// usable read link is read-only, so this is a no-op for it — no sheet opens.
	/// The sheet is presented immediately; the session cookie is minted inside it.
	///
	/// The server `read` link is the same href every client follows; the app appends
	/// `?platform=ios` here so the server renders the reader chromeless inside the
	/// WKWebView, where the native list is the chrome. An href the client can't
	/// resolve or re-encode with the parameter is treated as absent (read-only row).
	func openReader(for article: Article) {
		guard let href = article.readHref,
			let url = Href.resolve(href, baseURL: api.baseURL),
			let readerURL = Href.appending(AppConfig.readerPlatformQueryItem, to: url)
		else { return }
		readerPresentation = ReaderPresentation(readerURL: readerURL, articleId: article.id)
	}

	/// Follows a navigable collection-level link (e.g. the `account` link) by opening
	/// its resolved href in the same in-app web view the reader uses. A link the
	/// client can't resolve (missing or foreign-scheme href) is a no-op, so an
	/// unactionable link advertised by the server never opens a blank sheet.
	///
	/// The href is the server's own; the app appends its app-shell marker so the
	/// server knows the page is hosted in the deep-link-intercepting sheet and may
	/// answer with a `readplace://` control. An href that can't be re-encoded with
	/// the marker is treated as absent, exactly like one that can't be resolved.
	func open(link: SirenLink) {
		guard let href = link.href,
			let url = Href.resolve(href, baseURL: api.baseURL),
			let shellURL = Href.appending(AppConfig.appShellQueryItem, to: url)
		else { return }
		readerPresentation = ReaderPresentation(readerURL: shellURL, articleId: nil)
	}

	func captureBlockedArticle(with captor: HTMLCapturing) async {
		guard let articleId = readerPresentation?.articleId,
			let article = articles.first(where: { $0.id == articleId }),
			let url = URL(string: article.url)
		else { return }
		do {
			let outcome = try await HealBlockedArticle(api: api, captor: captor).run(url: url)
			if let failureText = outcome.failureText {
				errorText = failureText
				return
			}
			await reloadAndAdopt()
		} catch {
			handle(error)
		}
	}

	func drainStagedUploads(with captor: HTMLCapturing) async {
		guard let jobs, !isDrainingUploads else { return }
		isDrainingUploads = true
		defer { isDrainingUploads = false }
		await DrainUploadJobs(api: api, captor: captor, jobs: jobs).run()
	}

	/// Mints the cookie session the reader webview needs from the current bearer.
	func mintReaderSession() async -> ReaderSessionMint {
		do {
			return .minted(try await api.bootstrapSession(action: sessionAction))
		} catch where Task.isCancelled {
			return .superseded
		} catch {
			handle(error)
			return .failed
		}
	}

	/// Applies a loaded page to the list. A replacing load (first page, refresh, or
	/// a post-action collection) becomes the whole list. A paginated load appends
	/// the rows the list doesn't already hold.
	private func apply(_ page: ReadlistPage, replacing: Bool) {
		if replacing {
			articles = page.articles
			pagesHeld = 1
			// A fresh successful collection reconciles transient banners: a stale
			// write-refusal (e.g. a since-verified locked account) or error is cleared
			// here, re-surfacing only if a later write is refused.
			messages = []
			errorText = nil
			// The list now holds first-page server truth, so any share-sheet save
			// recorded up to this point has been shown — including one saved before
			// a cold launch, which the launch load itself surfaces.
			unseenSave?.clear()
		} else {
			let existing = Set(articles.map(\.id))
			articles += page.articles.filter { !existing.contains($0.id) }
			pagesHeld += 1
		}
		hasLoadedOnce = true
		nextHref = page.nextHref
		hasMore = page.nextHref != nil
		// The toolbar is sourced from the current collection (a replacing load). A
		// paginated page only appends rows, so it neither clears the controls when it
		// advertises none nor flaps them to a page-scoped set — the first page owns
		// the toolbar for the whole scroll.
		if replacing {
			applyToolbar(page)
			sessionAction = page.action(named: "create-session")
			tabs = page.tabs
			appearance = page.appearance
			if let current = page.currentTabHref {
				currentTabHref = current
				selectedTabHref = current
			}
		}
		warningText = page.warning?.message
	}

	/// Derives the toolbar from a page's advertised affordances: a client-derived
	/// subset — each one the client can present as a toolbar control, dropping the
	/// rest by their presentation (a structural navigation link the client follows
	/// itself for pagination/identity, or a capture-only save reachable only via
	/// the Share Sheet) — not by name-gating a known capability. The client-side
	/// add (+) control is always appended so the reading list can reach the Share
	/// help regardless of what the server advertised. Because that + is client-owned,
	/// a same-token server affordance is dropped first (via the single isAddLinksHelp
	/// source), so the injected control stays canonical and a server that re-advertises
	/// add-links-help never renders a duplicate +.
	private func applyToolbar(_ page: ReadlistPage) {
		let serverControls = page.affordances.filter {
			$0.isToolbarControl && !Affordance.isAddLinksHelp($0.token)
		}
		collectionAffordances = serverControls + [Self.addLinksHelp]
	}

	private func handle(_ error: Error) {
		switch error {
		case APIError.unauthorized, APIError.noToken:
			onSessionExpired()
		case let APIError.refused(messages) where !messages.isEmpty:
			self.messages = messages
		default:
			errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
		}
	}
}

/// What the in-app web sheet needs to present a server URL: the resolved URL and,
/// for a reader opened from a row, that row's id. A navigable collection link
/// (e.g. `save`) carries no row, so `articleId` is nil. `Identifiable` drives
/// `.sheet(item:)`; the id falls back to the URL so a row-less sheet is still
/// uniquely presentable.
struct ReaderPresentation: Identifiable {
	let readerURL: URL
	let articleId: String?
	var id: String { articleId ?? readerURL.absoluteString }
}
