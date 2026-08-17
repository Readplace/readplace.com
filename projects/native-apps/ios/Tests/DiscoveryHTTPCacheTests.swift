import XCTest
@testable import Readplace

final class DiscoveryHTTPCacheTests: XCTestCase {
	func testBuildsAPersistentDiskCacheInsideTheSharedContainer() {
		let container = TestSupport.temporaryContainer()

		let configuration = DiscoveryHTTPCache.configuration(containerURL: container)

		XCTAssertEqual(configuration.urlCache?.memoryCapacity, 512 * 1024)
		XCTAssertEqual(configuration.urlCache?.diskCapacity, 10 * 1024 * 1024)
		XCTAssertEqual(configuration.requestCachePolicy, .useProtocolCachePolicy, "the server defines the lifetime, not the client")
		XCTAssertEqual(
			DiscoveryHTTPCache.directory(in: container).pathComponents.suffix(3).joined(separator: "/"),
			"Library/Caches/discovery-http-cache"
		)
	}

	func testKeepsItsCookieJarOutOfTheProcessWideStore() throws {
		let sharedCookies = HTTPCookieStorage.shared.cookies?.count ?? 0
		let configuration = DiscoveryHTTPCache.configuration(containerURL: TestSupport.temporaryContainer())
		let jar = try XCTUnwrap(configuration.httpCookieStorage)

		jar.setCookie(TestSupport.sessionCookie(value: "discovery-1"))

		XCTAssertEqual(jar.cookies?.map(\.value), ["discovery-1"])
		XCTAssertEqual(
			HTTPCookieStorage.shared.cookies?.count ?? 0, sharedCookies,
			"the isolated cookie jar the API relies on survives the cache being added"
		)
	}

	func testDegradesToNoDiskCacheWithoutAContainer() {
		let configuration = DiscoveryHTTPCache.configuration(containerURL: nil)

		XCTAssertEqual(configuration.urlCache?.diskCapacity, 0, "no container means cold discovery, never a cache outside the App Group")
	}

	func testPurgeRemovesTheCacheDirectory() throws {
		let container = TestSupport.temporaryContainer()
		let directory = DiscoveryHTTPCache.directory(in: container)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		try Data("cached".utf8).write(to: directory.appendingPathComponent("entry"))

		DiscoveryHTTPCache.purge(containerURL: container)

		XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
	}
}
