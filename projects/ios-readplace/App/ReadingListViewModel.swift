import Foundation

@MainActor
final class ReadingListViewModel: ObservableObject {
	@Published private(set) var articles: [Article] = []
	@Published private(set) var isLoading = false
	@Published private(set) var isSaving = false
	@Published private(set) var hasMore = false
	@Published var errorText: String?
	@Published var warningText: String?
	/// Server-authored messages surfaced to the UI (e.g. a locked-account refusal),
	/// rendered generically — the client owns no per-feature knowledge of them.
	@Published var messages: [ServerMessage] = []
	/// Set when a readable row is tapped; drives the reader sheet. The session
	/// cookie is minted inside the sheet, so the sheet opens without waiting.
	@Published var readerPresentation: ReaderPresentation?

	private var nextHref: String?
	private var isLoadingMore = false
	private var saveArticleAction: SirenAction?

	private let api: ReadplaceAPI
	private let onSessionExpired: () -> Void

	init(api: ReadplaceAPI, onSessionExpired: @escaping () -> Void) {
		self.api = api
		self.onSessionExpired = onSessionExpired
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
		// then re-surface it only if the next save is refused again.
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

	func markAsRead(_ article: Article) async {
		guard let action = article.updateStatusAction else { return }
		let snapshot = articles
		// Optimistically drop the row, then confirm with the server. Nothing is
		// re-applied on success, so the pagination cursor (nextHref/hasMore)
		// survives; a failure restores the snapshot and surfaces the error.
		articles.removeAll { $0.id == article.id }
		do {
			try await api.updateStatus(action: action, status: .read)
		} catch {
			articles = snapshot
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

	func saveURL(_ rawURL: String) async {
		let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty, let action = saveArticleAction else { return }
		isSaving = true
		errorText = nil
		messages = []
		do {
			_ = try await api.saveArticle(action: action, url: trimmed)
			await fetchFirstPage()
		} catch {
			handle(error)
		}
		isSaving = false
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
		if let save = page.saveArticleAction { saveArticleAction = save }
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

/// What the reader sheet needs to present one article: the resolved reader URL
/// and the article id (so its row can be dropped if the reader marks it read).
/// `Identifiable` drives `.sheet(item:)`.
struct ReaderPresentation: Identifiable {
	let readerURL: URL
	let articleId: String
	var id: String { articleId }
}
