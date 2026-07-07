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
	/// + control works before (and regardless of) a queue load.
	let addLinksHelpURL: URL?

	/// The collection-level controls the toolbar renders. The server's own collection
	/// affordances are looped (each presentable one becomes a control), and the
	/// client-side add (+) control that opens the Share help is always present — it is
	/// injected by the client and kept canonical, so any add-links-help the server
	/// also advertises is deduped rather than rendered as a second +.
	@Published private(set) var collectionAffordances: [Affordance] = [ReadingListViewModel.addLinksHelp]

	private var nextHref: String?
	private var isLoadingMore = false
	/// Whether rows beyond the first page are loaded. A post-action adoption
	/// replaces the list outright only while everything on screen came from one
	/// page; once the user has scrolled deeper, adoption merges instead, so the
	/// rows anchoring the scroll position survive (see `adopt`).
	private var hasPaginated = false
	/// Whether a collection has ever been applied. Gates the foreground refresh so
	/// it never races the initial `.task` load with a second fetch at launch.
	private var hasLoadedOnce = false
	/// The row the reader marked read behind the web sheet, awaiting the dismissal
	/// converge; consumed by `handleWebSheetDismissal` so the drop survives exactly
	/// one re-read.
	private var readerDroppedId: String?

	private let api: ReadplaceAPI
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

	init(api: ReadplaceAPI, onSessionExpired: @escaping () -> Void) {
		self.api = api
		self.onSessionExpired = onSessionExpired
		addLinksHelpURL = Href.resolve(AppConfig.addLinksHelpPath, baseURL: api.baseURL)
	}

	func loadIfNeeded() async {
		guard articles.isEmpty else { return }
		await fetchFirstPage()
	}

	func refresh() async {
		await fetchFirstPage()
	}

	private func fetchFirstPage() async {
		isLoading = true
		errorText = nil
		// A locked account's reads still succeed, so a fresh load reconciles a
		// stale refusal banner (e.g. after verifying elsewhere): clear it here,
		// then re-surface it only if a later write (e.g. mark-as-read) is refused.
		messages = []
		do {
			let page = try await api.loadQueue()
			apply(page, replacing: true)
		} catch {
			handle(error)
		}
		isLoading = false
	}

	func loadMore() async {
		guard let next = nextHref, !isLoadingMore else { return }
		isLoadingMore = true
		do {
			let page = try await api.loadQueue(path: next)
			apply(page, replacing: false)
		} catch {
			handle(error)
		}
		isLoadingMore = false
	}

	/// Invokes one of an item's advertised actions via the action's own
	/// href/method/fields. The client supplies no field knowledge: every declared
	/// field's server-suggested `value` is posted by the generic invoker, so a bare
	/// (action, item) invocation is sufficient — `update-status` carries its target
	/// status as the field `value`, not a client constant. On success the list
	/// converges to whatever collection the server drove the invoke back to — the
	/// post-action truth, carrying changes made elsewhere (an item marked unread on
	/// the website appears right here). A failure surfaces the error and leaves the
	/// current list in place; there is no optimistic removal to roll back.
	func invoke(_ action: SirenAction, on article: Article) async {
		let removesItem = Affordance(action: action)?.removesItemFromUnreadList ?? false
		do {
			let page = try await api.invoke(action: action)
			adopt(page, droppingId: removesItem ? article.id : nil)
		} catch {
			handle(error)
		}
	}

	/// Invokes a collection-level action via its own href/method/type/fields through
	/// the generic invoker — the bare-invokable toolbar control path. The action
	/// carries no row and reshapes the whole list (e.g. a purge), so the server's
	/// post-invoke collection replaces it outright; when the invoke lands on no
	/// collection, a fresh first-page load converges instead. A failure surfaces
	/// the error and leaves the current list in place.
	func invokeCollection(_ action: SirenAction) async {
		do {
			if let page = try await api.invoke(action: action) {
				apply(page, replacing: true)
			} else {
				await fetchFirstPage()
			}
		} catch {
			handle(error)
		}
	}

	/// Drops the row the reader just marked read — instantly, so the unread-only
	/// list never shows it again behind the sheet. The reader's own POST answers
	/// inside the webview where no Siren body is available, so reconciliation
	/// belongs to the converge the sheet's dismissal triggers
	/// (`handleWebSheetDismissal`); the id is remembered so that converge keeps
	/// the row dropped even if an eventually-consistent server GET still lists it.
	func readerMarkedRead(id: String) {
		articles.removeAll { $0.id == id }
		readerDroppedId = id
	}

	/// Re-reads the list when the app returns to the foreground, so changes made
	/// while backgrounded — a share-sheet save, an item marked unread on the
	/// website — appear without pull-to-refresh. Gated on a completed first load:
	/// at launch the `.task` load owns the fetch and this is a no-op. A deep-scrolled
	/// list is not re-read at all — reconciliation waits for a pull-to-refresh, the
	/// user's explicit re-read — so returning to the app never yanks their position.
	func handleForeground() async {
		guard hasLoadedOnce, !hasPaginated else { return }
		await reloadAndAdopt(droppingId: nil)
	}

	/// Probes the server when the in-app web sheet closes, so a session the
	/// sheet's own page just killed is discovered immediately. The sheet can host
	/// the account page, whose delete-account flow destroys every session and
	/// revokes every OAuth token server-side, and nothing else fires promptly
	/// after that: the scene never leaves `.active` for an in-app sheet, and the
	/// foreground converge is zero-network once the list has paginated — so
	/// without this probe the app would keep showing the deleted account's cached
	/// list until some later call happened to 401. The probe therefore always hits
	/// the network (no `!hasPaginated` gate, unlike the foreground re-read): against
	/// a dead session it 401s, the refresh fails on the revoked token, and the
	/// failure funnels into the existing `onSessionExpired` sign-out — clearing the
	/// TokenStore and the cached UI. A live session pays one shallow
	/// re-read, which doubles as the same reconciliation the foreground performs;
	/// a deep-scrolled list still holds its position (`adopt` discards the page).
	/// Carries the row the reader marked read behind this sheet, so the adopted
	/// page never resurrects it (see `readerMarkedRead`).
	func handleWebSheetDismissal() async {
		let droppedId = readerDroppedId
		readerDroppedId = nil
		await reloadAndAdopt(droppingId: droppedId)
	}

	/// Reconciles the visible list with the server's post-action collection.
	///
	/// While the user is near the top (only the first page loaded) the collection
	/// replaces the list outright — pure server truth, dropping the acted-on row and
	/// surfacing whatever changed elsewhere. Once the user has scrolled deeper,
	/// replacing would collapse the list to one page and yank the scroll, and
	/// splicing a fresh head above the viewport would shift it (a plain `List` does
	/// not hold its offset across an above-viewport insert), so a deep-scrolled list
	/// stays exactly where it is: the only change applied is the confirmed removal
	/// of the acted-on row. The rest reconciles on the next pull-to-refresh — the
	/// user's explicit "re-read now" gesture, which is the one place a jump to the
	/// top is expected. With no collection to adopt (a non-collection response) the
	/// server directed no re-list, so again only the confirmed removal is applied.
	private func adopt(_ page: QueuePage?, droppingId removedId: String?) {
		guard !hasPaginated, let page else {
			if let removedId { articles.removeAll { $0.id == removedId } }
			return
		}
		apply(page, replacing: true, droppingId: removedId)
	}

	/// Re-reads the first page and reconciles it through `adopt`, under an
	/// in-flight guard so overlapping triggers (rapid app switches, a sheet
	/// dismissal racing a foreground re-read) can't interleave. `adopt` still
	/// holds a deep-scrolled viewport, so for the dismissal probe of a paginated
	/// list the request serves as a bare authenticated probe whose body is
	/// discarded.
	private func reloadAndAdopt(droppingId removedId: String?) async {
		guard !isLoading else { return }
		isLoading = true
		defer { isLoading = false }
		do {
			let page = try await api.loadQueue()
			adopt(page, droppingId: removedId)
		} catch {
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

	/// Follows a navigable collection-level link (e.g. a `save` link) by opening
	/// its resolved href in the same in-app web view the reader uses. A link the
	/// client can't resolve (missing or foreign-scheme href) is a no-op, so an
	/// unactionable link advertised by the server never opens a blank sheet. No
	/// row is associated, so the web sheet drops nothing when it closes.
	func open(link: SirenLink) {
		guard let href = link.href,
			let url = Href.resolve(href, baseURL: api.baseURL)
		else { return }
		readerPresentation = ReaderPresentation(readerURL: url, articleId: nil)
	}

	/// Mints the cookie session the reader webview needs from the current bearer.
	/// Returns nil and surfaces the error when the bootstrap fails, so the reader
	/// sheet can show its unavailable view instead of a blank page.
	func mintReaderSession() async -> HTTPCookie? {
		do {
			return try await api.bootstrapSession()
		} catch {
			handle(error)
			return nil
		}
	}

	/// Applies a loaded page to the list. A replacing load (first page, refresh, or
	/// a post-action collection) becomes the whole list, minus the acted-on row when
	/// one is given — so a just-removed row never reappears even if an
	/// eventually-consistent server GET still lists it. A paginated load appends the
	/// rows the list doesn't already hold. `droppingId` matters only for a replacing
	/// load; an append never re-introduces a removed row because its ids are already
	/// present.
	private func apply(_ page: QueuePage, replacing: Bool, droppingId removedId: String? = nil) {
		if replacing {
			articles = page.articles.filter { $0.id != removedId }
			hasPaginated = false
			// A fresh successful collection reconciles transient banners: a stale
			// write-refusal (e.g. a since-verified locked account) or error is cleared
			// here, re-surfacing only if a later write is refused.
			messages = []
			errorText = nil
		} else {
			let existing = Set(articles.map(\.id))
			articles += page.articles.filter { !existing.contains($0.id) }
			hasPaginated = true
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
	private func applyToolbar(_ page: QueuePage) {
		let serverControls = page.affordances.filter {
			$0.isToolbarControl && !Affordance.isAddLinksHelp($0.token)
		}
		collectionAffordances = serverControls + [Self.addLinksHelp]
	}

	private func handle(_ error: Error) {
		switch error {
		case APIError.unauthorized, APIError.noToken:
			onSessionExpired()
		case let APIError.refused(messages):
			self.messages = messages
		default:
			errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
		}
	}
}

/// What the in-app web sheet needs to present a server URL: the resolved URL and,
/// for a reader opened from a row, that row's id (so the row can be dropped if the
/// reader marks it read). A navigable collection link (e.g. `save`) carries no
/// row, so `articleId` is nil and nothing is dropped on close. `Identifiable`
/// drives `.sheet(item:)`; the id falls back to the URL so a row-less sheet is
/// still uniquely presentable.
struct ReaderPresentation: Identifiable {
	let readerURL: URL
	let articleId: String?
	var id: String { articleId ?? readerURL.absoluteString }
}
