import Foundation

enum ReadlistHTTPCache {
	static func directory(in container: AppGroupContainer) -> URL {
		container.url.appendingPathComponent("Library/Caches/readlist-http-cache", isDirectory: true)
	}

	static func configuration(in container: AppGroupContainer) -> URLSessionConfiguration {
		let configuration = URLSessionConfiguration.ephemeral
		configuration.urlCache = URLCache(
			memoryCapacity: 512 * 1024,
			diskCapacity: 10 * 1024 * 1024,
			directory: directory(in: container)
		)
		return configuration
	}
}
