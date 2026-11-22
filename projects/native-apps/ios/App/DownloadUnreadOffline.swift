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
	let contentState: ContentState?
	let request: URLRequest

	var withUnknownContentState: OfflineArticle {
		OfflineArticle(id: id, contentVersion: contentVersion, contentState: nil, request: request)
	}
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
	static let resolutionWaitCap: TimeInterval = 15 * 60

	let api: ReadplaceAPI
	let prefetchers: [ReaderPrefetching]
	let sessionAction: SirenAction?
	let manifest: OfflineDownloadManifest
	let snapshot: OfflineReadlistSnapshot
	let pause: (TimeInterval) async throws -> Void
	let now: () -> Date

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

	private struct Row {
		let article: OfflineArticle
		let refreshAfterSeconds: TimeInterval?
	}

	private struct HeldRow {
		let article: OfflineArticle
		let refreshAfterSeconds: TimeInterval
		let pageHref: String
	}

	private struct ResolvingPages {
		let hrefs: [String]
		let held: [HeldRow]
		let next: NextLink?
	}

	private struct NextLink {
		let href: String
		let isOfflinePrefetch: Bool
	}

	private final class Ledger {
		private var counted: Set<String> = []
		private var queued: Set<String> = []

		func count(_ rows: [Row], in tally: Tally) {
			for row in rows where counted.insert(row.article.id).inserted {
				tally.total += 1
			}
		}

		func isQueued(_ id: String) -> Bool {
			queued.contains(id)
		}

		func unqueued(_ articles: [OfflineArticle]) -> [OfflineArticle] {
			articles.filter { queued.insert($0.id).inserted }
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
		report: @escaping () -> Void
	) async throws {
		defer { queue.close() }
		try await walkPages(
			from: NextLink(href: href, isOfflinePrefetch: false), into: queue, ledger: Ledger(), tally: tally, report: report
		)
		tally.walking = false
		report()
	}

	private func walkPages(
		from start: NextLink?,
		into queue: OfflineArticleQueue,
		ledger: Ledger,
		tally: Tally,
		report: @escaping () -> Void
	) async throws {
		var link = start
		while let current = link {
			guard !current.isOfflinePrefetch else {
				link = try await storeAsLastSeen(current.href, into: queue, ledger: ledger, tally: tally, report: report)
				continue
			}
			let resolving = try await loadResolvingPages(from: current.href, into: queue, ledger: ledger, tally: tally, report: report)
			try await withThrowingTaskGroup(of: Void.self) { group in
				group.addTask {
					try await finishResolution(of: resolving, into: queue, ledger: ledger, tally: tally, report: report)
				}
				group.addTask {
					try await walkPages(from: resolving.next, into: queue, ledger: ledger, tally: tally, report: report)
				}
				try await group.waitForAll()
			}
			return
		}
	}

	private func storeAsLastSeen(
		_ href: String,
		into queue: OfflineArticleQueue,
		ledger: Ledger,
		tally: Tally,
		report: () -> Void
	) async throws -> NextLink? {
		let page = try await api.prefetchReadlist(path: href)
		snapshot.save(page, href: href, savedAt: now())
		let rows = unreadRows(on: page)
		ledger.count(rows, in: tally)
		report()
		queue.push(ledger.unqueued(rows.map(\.article)))
		return nextLink(of: page)
	}

	private func loadResolvingPages(
		from href: String,
		into queue: OfflineArticleQueue,
		ledger: Ledger,
		tally: Tally,
		report: () -> Void
	) async throws -> ResolvingPages {
		var resolvingPages: [String] = []
		var held: [HeldRow] = []
		var link: NextLink? = NextLink(href: href, isOfflinePrefetch: false)
		while let current = link, !current.isOfflinePrefetch {
			let page = try await api.loadReadlist(path: current.href)
			snapshot.save(page, href: current.href, savedAt: now())
			resolvingPages.append(current.href)
			let rows = unreadRows(on: page)
			ledger.count(rows, in: tally)
			report()
			var settled: [OfflineArticle] = []
			for row in rows where !ledger.isQueued(row.article.id) {
				held.removeAll { $0.article.id == row.article.id }
				if let refreshAfterSeconds = row.refreshAfterSeconds {
					held.append(HeldRow(article: row.article, refreshAfterSeconds: refreshAfterSeconds, pageHref: current.href))
				} else {
					settled.append(row.article)
				}
			}
			queue.push(ledger.unqueued(settled))
			link = nextLink(of: page)
		}
		return ResolvingPages(hrefs: resolvingPages, held: held, next: link)
	}

	private func finishResolution(
		of resolving: ResolvingPages,
		into queue: OfflineArticleQueue,
		ledger: Ledger,
		tally: Tally,
		report: () -> Void
	) async throws {
		let unsettled = try await waitForResolution(
			of: resolving.held, on: resolving.hrefs, into: queue, ledger: ledger, tally: tally, report: report
		)
		queue.push(ledger.unqueued(unsettled.map(\.article)))
	}

	private func waitForResolution(
		of initiallyHeld: [HeldRow],
		on resolvingPages: [String],
		into queue: OfflineArticleQueue,
		ledger: Ledger,
		tally: Tally,
		report: () -> Void
	) async throws -> [HeldRow] {
		var held = initiallyHeld
		let started = now()
		while let interval = held.map(\.refreshAfterSeconds).min(),
			now().timeIntervalSince(started) < Self.resolutionWaitCap
		{
			try await pause(interval)
			let due = resolvingPages.filter { page in held.contains { $0.pageHref == page } }
			var reloaded: Set<String> = []
			var observed: Set<String> = []
			for pageHref in due {
				guard let page = try await reload(pageHref) else { continue }
				reloaded.insert(pageHref)
				snapshot.save(page, href: pageHref, savedAt: now())
				let rows = unreadRows(on: page)
				ledger.count(rows, in: tally)
				var settled: [OfflineArticle] = []
				for row in rows {
					observed.insert(row.article.id)
					let wasHeld = held.contains { $0.article.id == row.article.id }
					held.removeAll { $0.article.id == row.article.id }
					if wasHeld, let refreshAfterSeconds = row.refreshAfterSeconds {
						held.append(HeldRow(article: row.article, refreshAfterSeconds: refreshAfterSeconds, pageHref: pageHref))
					} else {
						settled.append(row.article)
					}
				}
				report()
				queue.push(ledger.unqueued(settled))
			}
			let unobservable = held.filter { reloaded.contains($0.pageHref) && !observed.contains($0.article.id) }
			held.removeAll { row in unobservable.contains { $0.article.id == row.article.id } }
			queue.push(ledger.unqueued(unobservable.map(\.article.withUnknownContentState)))
		}
		return held
	}

	private func reload(_ href: String) async throws -> ReadlistPage? {
		do {
			return try await api.prefetchReadlist(path: href)
		} catch let error where Task.isCancelled || Self.endsTheSession(error) {
			throw error
		} catch {
			return nil
		}
	}

	private static func endsTheSession(_ error: Error) -> Bool {
		switch error {
		case APIError.unauthorized, APIError.noToken: return true
		default: return false
		}
	}

	private func drain(
		_ queue: OfflineArticleQueue,
		with prefetcher: ReaderPrefetching,
		tally: Tally,
		report: () -> Void
	) async throws {
		while let article = await queue.next() {
			if manifest.isCurrent(articleId: article.id, contentVersion: article.contentVersion) {
				manifest.record(contentState: article.contentState, articleId: article.id)
				tally.completed += 1
				report()
				continue
			}
			let cookies = try await sessionCookies(tally)
			guard !Task.isCancelled else { return }
			let stored = await prefetcher.prefetch(request: article.request, cookies: cookies)
			guard !Task.isCancelled else { return }
			if stored, let version = article.contentVersion {
				manifest.recordDownloaded(articleId: article.id, contentVersion: version, contentState: article.contentState)
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

	private func nextLink(of page: ReadlistPage) -> NextLink? {
		page.nextHref.map { NextLink(href: $0, isOfflinePrefetch: page.nextIsOfflinePrefetch) }
	}

	private func unreadRows(on page: ReadlistPage) -> [Row] {
		page.articles
			.filter { !$0.isRead }
			.compactMap { article in
				ReaderRequest.prefetch(readHref: article.readHref, baseURL: api.baseURL).map {
					Row(
						article: OfflineArticle(
							id: article.id,
							contentVersion: article.contentVersion,
							contentState: article.contentState,
							request: $0
						),
						refreshAfterSeconds: article.processing?.refreshAfterSeconds
					)
				}
			}
	}
}
