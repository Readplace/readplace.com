import Foundation

struct OfflineDownloadProgress: Equatable {
	let completed: Int
	let total: Int
	let failed: Int

	var label: String {
		total == 0 ? "Finding unread articles…" : "Downloading \(completed) of \(total) for offline reading"
	}

	var fraction: Double {
		total == 0 ? 0 : Double(completed) / Double(total)
	}
}

extension OfflineDownloadRun {
	var resumeLabel: String {
		"\(completed) of \(total) downloaded for offline reading"
	}

	var fraction: Double {
		total == 0 ? 0 : Double(completed) / Double(total)
	}
}

enum OfflineDownloadOutcome: Equatable {
	case downloaded
	case partiallyDownloaded(failed: Int, total: Int)
	case cancelled
	case nothingToDownload

	var failureText: String? {
		guard case .partiallyDownloaded(let failed, let total) = self else { return nil }
		return "\(failed) of \(total) articles couldn't be downloaded for offline reading"
	}
}

@MainActor
protocol ReaderPrefetching {
	func prefetch(request: URLRequest, cookies: [HTTPCookie]) async -> Bool
	func waitUntilStored() async
}

enum ReaderPrefetch {
	static func wasStored(mainFrameStatus: Int?, mainDocumentLoaded: Bool) -> Bool {
		mainFrameStatus == 200 && mainDocumentLoaded
	}
}

struct OfflineArticle {
	let id: String
	let contentVersion: String?
	let request: URLRequest
}

@MainActor
final class OfflineArticleQueue {
	private var waiting: [OfflineArticle] = []
	private var closed = false
	private var sleepers: [CheckedContinuation<Void, Never>] = []

	func push(_ articles: [OfflineArticle]) {
		waiting += articles
		wake()
	}

	func close() {
		closed = true
		wake()
	}

	func next() async -> OfflineArticle? {
		while waiting.isEmpty && !closed {
			await withCheckedContinuation { sleepers.append($0) }
		}
		guard !Task.isCancelled, !waiting.isEmpty else { return nil }
		return waiting.removeFirst()
	}

	private func wake() {
		let woken = sleepers
		sleepers = []
		for sleeper in woken { sleeper.resume() }
	}
}

@MainActor
struct DownloadUnreadOffline {
	static let concurrentArticles = 4

	let api: ReadplaceAPI
	let prefetchers: [ReaderPrefetching]
	let sessionAction: SirenAction?
	let manifest: OfflineDownloadManifest
	let snapshot: OfflineReadlistSnapshot

	private final class Tally {
		let expectedTotal: Int
		var walking = true
		var total = 0
		var completed = 0
		var failed = 0
		var cookies: Task<[HTTPCookie], Error>?

		init(expectedTotal: Int) {
			self.expectedTotal = expectedTotal
		}

		var shownTotal: Int { walking ? max(total, expectedTotal) : total }

		var progress: OfflineDownloadProgress {
			OfflineDownloadProgress(completed: completed, total: shownTotal, failed: failed)
		}
	}

	func run(
		from href: String,
		expectedTotal: Int,
		onProgress: @escaping (OfflineDownloadProgress) -> Void
	) async throws -> OfflineDownloadOutcome {
		do {
			return try await download(from: href, tally: Tally(expectedTotal: expectedTotal), onProgress: onProgress)
		} catch where Task.isCancelled {
			return .cancelled
		}
	}

	private func download(
		from href: String,
		tally: Tally,
		onProgress: @escaping (OfflineDownloadProgress) -> Void
	) async throws -> OfflineDownloadOutcome {
		let queue = OfflineArticleQueue()
		let report = {
			onProgress(tally.progress)
			manifest.record(run: OfflineDownloadRun(total: tally.shownTotal, completed: tally.completed))
		}
		try await withThrowingTaskGroup(of: Void.self) { group in
			group.addTask {
				try await walk(from: href, into: queue, tally: tally, report: report)
			}
			for prefetcher in prefetchers {
				group.addTask {
					try await drain(queue, with: prefetcher, tally: tally, report: report)
				}
			}
			try await group.waitForAll()
		}
		guard !Task.isCancelled else { return .cancelled }
		guard tally.total > 0 else {
			manifest.forgetRun()
			return .nothingToDownload
		}
		if tally.cookies != nil { await prefetchers.first?.waitUntilStored() }
		guard !Task.isCancelled else { return .cancelled }
		manifest.forgetRun()
		return tally.failed == 0 ? .downloaded : .partiallyDownloaded(failed: tally.failed, total: tally.total)
	}

	private func walk(
		from href: String,
		into queue: OfflineArticleQueue,
		tally: Tally,
		report: () -> Void
	) async throws {
		defer { queue.close() }
		var path: String? = href
		while let current = path {
			let page = try await api.loadReadlist(path: current)
			snapshot.save(page, href: current, savedAt: Date())
			let unread = unreadArticles(on: page)
			tally.total += unread.count
			report()
			queue.push(unread)
			path = page.nextHref
		}
		tally.walking = false
		report()
	}

	private func drain(
		_ queue: OfflineArticleQueue,
		with prefetcher: ReaderPrefetching,
		tally: Tally,
		report: () -> Void
	) async throws {
		while let article = await queue.next() {
			if manifest.isCurrent(articleId: article.id, contentVersion: article.contentVersion) {
				tally.completed += 1
				report()
				continue
			}
			let cookies = try await sessionCookies(tally)
			guard !Task.isCancelled else { return }
			let stored = await prefetcher.prefetch(request: article.request, cookies: cookies)
			guard !Task.isCancelled else { return }
			if stored, let version = article.contentVersion {
				manifest.recordDownloaded(articleId: article.id, contentVersion: version)
			}
			if !stored { tally.failed += 1 }
			tally.completed += 1
			report()
		}
	}

	private func sessionCookies(_ tally: Tally) async throws -> [HTTPCookie] {
		if let minting = tally.cookies { return try await minting.value }
		let minting = Task { [api, sessionAction] in try await api.bootstrapSession(action: sessionAction) }
		tally.cookies = minting
		return try await minting.value
	}

	private func unreadArticles(on page: ReadlistPage) -> [OfflineArticle] {
		page.articles
			.filter { !$0.isRead }
			.compactMap { article in
				ReaderRequest.prefetch(readHref: article.readHref, baseURL: api.baseURL).map {
					OfflineArticle(id: article.id, contentVersion: article.contentVersion, request: $0)
				}
			}
	}
}
