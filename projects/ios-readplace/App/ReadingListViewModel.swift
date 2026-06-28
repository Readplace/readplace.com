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
	/// webview. A client-owned path resolved against the API base — the server no
	/// longer advertises it — so the + control works before (and regardless of) a
	/// queue load.
	let addLinksHelpURL: URL?

	/// The collection-level controls the toolbar renders. The server's own collection
	/// affordances are looped (each presentable one becomes a control), and the
	/// client-side add (+) control that opens the Share help is always present — it is
	/// injected by the client, never advertised by the server.
	@Published private(set) var collectionAffordances: [Affordance] = [ReadingListViewModel.addLinksHelp]

	private var nextHref: String?
	private var isLoadingMore = false

	private let api: ReadplaceAPI
	private let onSessionExpired: () -> Void

	/// The reading list's client-side add (+) control: a navigable `add-links-help`
	/// affordance the client injects itself rather than discovering from the server.
	/// Tapping it opens the native Share-help sheet (`ToolbarRoute.presentAddLinksHelp`);
	/// the server advertises no such link, so the toolbar's add control is owned
	/// entirely by the client. Built from constant inputs, so it always constructs.
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
	/// status as the field `value`, not a client constant. Whether the row leaves
	/// the unread-only list is derived from that transition, not the action name:
	/// `delete` always removes, an `update-status` toggle removes only when its
	/// `status` value is `read` (a toggle back to `unread` leaves the row), and any
	/// other action leaves the list untouched for the next load to reconcile. A row
	/// that removes drops optimistically and the server confirms; a failed removal
	/// restores the snapshot and surfaces the error.
	func invoke(_ action: SirenAction, on article: Article) async {
		let removesItem = Affordance(action: action)?.removesItemFromUnreadList ?? false
		let snapshot = articles
		// Optimistically drop the row only for an item-removing action, then confirm
		// with the server. Nothing is re-applied on success, so the pagination cursor
		// (nextHref/hasMore) survives; a failure restores the snapshot.
		if removesItem { articles.removeAll { $0.id == article.id } }
		do {
			try await api.invoke(action: action)
		} catch {
			if removesItem { articles = snapshot }
			handle(error)
		}
	}

	/// Invokes a collection-level action via its own href/method/type/fields through
	/// the generic invoker — the bare-invokable toolbar control path. The action
	/// carries no row, so nothing is dropped optimistically; the server is the source
	/// of truth, so a successful invoke reloads the collection to reflect the new
	/// state. A failure surfaces the error and leaves the current list in place.
	func invokeCollection(_ action: SirenAction) async {
		do {
			try await api.invoke(action: action)
			await fetchFirstPage()
		} catch {
			handle(error)
		}
	}

	/// Removes a row after the reader marked it read, so it leaves the
	/// unread-only list without a round trip.
	func removeArticle(id: String) {
		articles.removeAll { $0.id == id }
	}

	/// Opens the reader for a tapped row. A row whose server response carries no
	/// usable read link is read-only, so this is a no-op for it — no sheet opens.
	/// The sheet is presented immediately; the session cookie is minted inside it.
	func openReader(for article: Article) {
		guard let href = article.readHref,
			let url = Href.resolve(href, baseURL: api.baseURL)
		else { return }
		readerPresentation = ReaderPresentation(readerURL: url, articleId: article.id)
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

	private func apply(_ page: QueuePage, replacing: Bool) {
		if replacing {
			articles = page.articles
		} else {
			let existing = Set(articles.map(\.id))
			articles += page.articles.filter { !existing.contains($0.id) }
		}
		nextHref = page.nextHref
		hasMore = page.nextHref != nil
		// The toolbar renders a client-derived subset of the advertised affordances:
		// each one the client can present as a toolbar control, dropping the rest by
		// their presentation (a structural navigation link the client follows itself
		// for pagination/identity, or a capture-only save reachable only via the
		// Share Sheet) — not by name-gating a known capability. The client-side add
		// (+) control is always appended so the reading list can reach the Share help
		// regardless of what the server advertised. The toolbar is sourced from the
		// replacing (first-page) load only: that load is the current collection, so
		// its subset is the current toolbar. A paginated page only appends rows, so it
		// neither clears the controls when it advertises none nor flaps them to a
		// page-scoped set — the first page owns the toolbar for the whole scroll.
		if replacing {
			collectionAffordances = page.affordances.filter(\.isToolbarControl) + [Self.addLinksHelp]
		}
		warningText = page.warning?.message
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
