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

@MainActor
struct DownloadUnreadOffline {
	let api: ReadplaceAPI
	let prefetcher: ReaderPrefetching
	let sessionAction: SirenAction?

	func run(from href: String, onProgress: (OfflineDownloadProgress) -> Void) async throws -> OfflineDownloadOutcome {
		do {
			return try await download(from: href, onProgress: onProgress)
		} catch where Task.isCancelled {
			return .cancelled
		}
	}

	private func download(
		from href: String,
		onProgress: (OfflineDownloadProgress) -> Void
	) async throws -> OfflineDownloadOutcome {
		let requests = try await unreadReaderRequests(from: href)
		guard !requests.isEmpty else { return .nothingToDownload }
		let cookies = try await api.bootstrapSession(action: sessionAction)
		var failed = 0
		for (completed, request) in requests.enumerated() {
			onProgress(OfflineDownloadProgress(completed: completed, total: requests.count, failed: failed))
			guard !Task.isCancelled else { return .cancelled }
			if await !prefetcher.prefetch(request: request, cookies: cookies) { failed += 1 }
		}
		onProgress(OfflineDownloadProgress(completed: requests.count, total: requests.count, failed: failed))
		await prefetcher.waitUntilStored()
		return failed == 0 ? .downloaded : .partiallyDownloaded(failed: failed, total: requests.count)
	}

	private func unreadReaderRequests(from href: String) async throws -> [URLRequest] {
		var page = try await api.loadReadlist(path: href)
		var requests = unreadReaderRequests(on: page)
		while let next = page.nextHref {
			page = try await api.loadReadlist(path: next)
			requests += unreadReaderRequests(on: page)
		}
		return requests
	}

	private func unreadReaderRequests(on page: ReadlistPage) -> [URLRequest] {
		page.articles
			.filter { !$0.isRead }
			.compactMap { ReaderRequest.prefetch(readHref: $0.readHref, baseURL: api.baseURL) }
	}
}
