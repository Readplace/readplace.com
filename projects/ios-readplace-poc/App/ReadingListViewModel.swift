import Foundation

/// A locked-account refusal surfaced to the UI: the server's message, which
/// itself names the address to email. The refusal models no action.
struct AccountLockout: Equatable {
	let message: String
}

@MainActor
final class ReadingListViewModel: ObservableObject {
	@Published private(set) var articles: [Article] = []
	@Published private(set) var isLoading = false
	@Published private(set) var isSaving = false
	@Published private(set) var hasMore = false
	@Published var errorText: String?
	@Published var warningText: String?
	@Published var lockout: AccountLockout?

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

	func delete(_ article: Article) async {
		guard let href = article.deleteHref else { return }
		let snapshot = articles
		articles.removeAll { $0.id == article.id }
		do {
			let page = try await api.delete(href: href)
			apply(page, replacing: true)
		} catch APIError.notFound {
			// Already gone server-side; keep it removed.
		} catch {
			articles = snapshot
			handle(error)
		}
	}

	func saveURL(_ rawURL: String) async {
		let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty, let action = saveArticleAction else { return }
		isSaving = true
		errorText = nil
		lockout = nil
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
		case let APIError.accountLocked(message):
			lockout = AccountLockout(message: message)
		default:
			errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
		}
	}
}
