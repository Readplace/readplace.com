import Foundation

enum ReaderSessionMint: Equatable {
	case minted([HTTPCookie])
	case offline
	case failed
	case superseded
}

enum ReaderBootstrap: Equatable {
	case loading
	case ready([HTTPCookie])
	case offline
	case unavailable

	init(after mint: ReaderSessionMint) {
		switch mint {
		case .minted(let cookies):
			self = .ready(cookies)
		case .offline:
			self = .offline
		case .failed:
			self = .unavailable
		case .superseded:
			self = .loading
		}
	}

	var cachePolicy: URLRequest.CachePolicy {
		OfflineReading.cachePolicy(offline: self == .offline)
	}

	func cachePolicy(reopenedFromCache: Bool) -> URLRequest.CachePolicy {
		reopenedFromCache ? OfflineReading.cachePolicy(offline: true) : cachePolicy
	}

	func showsOfflineBanner(fellBackToCache: Bool) -> Bool {
		fellBackToCache || self == .offline
	}
}

enum ReaderRequest {
	static func url(readHref: String?, baseURL: String) -> URL? {
		guard let href = readHref, let resolved = Href.resolve(href, baseURL: baseURL) else { return nil }
		return Href.appending(AppConfig.readerPlatformQueryItem, to: resolved)
	}

	static func open(url: URL, cachePolicy: URLRequest.CachePolicy) -> URLRequest {
		URLRequest(url: url, cachePolicy: cachePolicy, timeoutInterval: pageLoadTimeout)
	}

	static func prefetch(readHref: String?, baseURL: String) -> URLRequest? {
		guard let url = url(readHref: readHref, baseURL: baseURL) else { return nil }
		var request = URLRequest(url: url)
		request.setValue("prefetch", forHTTPHeaderField: "Sec-Purpose") // WebKit on iOS 17 discards a main-frame response requested with `Purpose: prefetch` and stores nothing; `Sec-Purpose` loads normally and the server already treats it as a prefetch
		return request
	}

	private static let pageLoadTimeout: TimeInterval = 10
}
