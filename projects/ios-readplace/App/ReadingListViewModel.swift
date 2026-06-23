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
	/// Set once a tapped row's reader session is ready; drives the reader sheet.
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
		// Optimistically drop the row. Unlike the old delete, the refreshed page
		// the server returns is discarded so pagination state (nextHref/hasMore)
		// survives instead of collapsing the list back to page 1.
		articles.removeAll { $0.id == article.id }
		do {
			_ = try await api.updateStatus(action: action, status: .read)
		} catch APIError.notFound {
			// Already read or gone server-side; keep it removed.
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

	/// Prefetches the session cookie the reader webview needs, then publishes the
	/// presentation that opens the reader sheet for this article.
	func prepareReader(for article: Article) async {
		guard let readHref = article.readHref else { return }
		do {
			let cookie = try await api.bootstrapSession()
			readerPresentation = ReaderPresentation(cookie: cookie, readHref: readHref, articleId: article.id)
		} catch {
			handle(error)
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

/// What the reader sheet needs to present one article: the prefetched session
/// cookie, the server-declared read href, and the article id (so its row can be
/// removed if the reader marks it read). `Identifiable` drives `.sheet(item:)`.
struct ReaderPresentation: Identifiable {
	let cookie: HTTPCookie
	let readHref: String
	let articleId: String
	var id: String { articleId }
}
