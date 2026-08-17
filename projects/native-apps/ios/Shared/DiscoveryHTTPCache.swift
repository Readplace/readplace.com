import Foundation

enum DiscoveryHTTPCache {
	static func directory(in containerURL: URL) -> URL {
		containerURL.appendingPathComponent("Library/Caches/discovery-http-cache", isDirectory: true)
	}

	static func configuration(containerURL: URL?) -> URLSessionConfiguration {
		let configuration = URLSessionConfiguration.ephemeral
		guard let containerURL else { return configuration }
		configuration.urlCache = URLCache(
			memoryCapacity: 512 * 1024,
			diskCapacity: 10 * 1024 * 1024,
			directory: directory(in: containerURL)
		)
		return configuration
	}

	static func purge(containerURL: URL) {
		try? FileManager.default.removeItem(at: directory(in: containerURL))
	}
}
