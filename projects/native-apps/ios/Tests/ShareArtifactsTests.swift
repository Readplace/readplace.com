import XCTest
@testable import Readplace

final class ShareArtifactsTests: XCTestCase {
	private func entitledContainer() throws -> URL {
		try XCTUnwrap(
			FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: TokenStore.resolvedAppGroupId),
			"the App Group this build is entitled to must resolve to a container"
		)
	}

	private func job(id: String) -> UploadJob {
		UploadJob(
			id: id,
			url: "https://example.com/\(id)",
			title: "A Title",
			state: .capturePending(detectedMediaType: nil),
			attempts: 0,
			nextAttemptAt: .distantPast,
			createdAt: .distantPast
		)
	}

	func testTakesTheQueuedUploadsAndTheCachedDiscoveryWithTheSession() async throws {
		let container = try entitledContainer()
		let jobs = UploadJobStore(containerURL: container)
		let queued = job(id: UUID().uuidString)
		try await jobs.admit(queued)
		let cache = DiscoveryHTTPCache.directory(in: container)
		try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
		let entry = cache.appendingPathComponent("entry")
		try Data("a cached queue response".utf8).write(to: entry)

		ShareArtifacts.purge(appGroupId: TokenStore.resolvedAppGroupId)

		XCTAssertEqual(jobs.loadAll(now: Date()), [])
		XCTAssertFalse(FileManager.default.fileExists(atPath: entry.path))
	}

	func testLeavesTheEntitledContainerAloneForAnAppGroupThisBuildCannotReach() async throws {
		let jobs = UploadJobStore(containerURL: try entitledContainer())
		let queued = job(id: UUID().uuidString)
		try await jobs.admit(queued)
		defer { jobs.remove(queued) }

		ShareArtifacts.purge(appGroupId: "group.com.readplace.not-entitled")

		XCTAssertEqual(jobs.loadAll(now: Date()).filter { $0.id == queued.id }, [queued])
	}
}
