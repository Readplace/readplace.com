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
		let unseenSave = UnseenSave(containerURL: container)
		unseenSave.record()
		XCTAssertTrue(unseenSave.exists, "precondition: a save is recorded")
		let cache = DiscoveryHTTPCache.directory(in: container)
		try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
		let entry = cache.appendingPathComponent("entry")
		try Data("a cached readlist response".utf8).write(to: entry)

		ShareArtifacts.purge(appGroupId: TokenStore.resolvedAppGroupId)

		XCTAssertEqual(jobs.loadAll(now: Date()), [])
		XCTAssertFalse(
			unseenSave.exists,
			"a save recorded for one account must not make the next account's list refresh"
		)
		XCTAssertFalse(FileManager.default.fileExists(atPath: entry.path))
	}

	func testTakesTheShareTargetAndTheLastViewedReadlistWithTheSession() throws {
		let group = TokenStore.resolvedAppGroupId
		let defaults = try XCTUnwrap(
			UserDefaults(suiteName: group),
			"the App Group this build is entitled to must resolve to a defaults suite"
		)
		ShareTarget(defaults: defaults).record(href: "/queue?queue=work")
		LastViewedReadlist(defaults: defaults).remember(href: "/queue?queue=work")

		ShareArtifacts.purge(appGroupId: group)

		XCTAssertNil(
			ShareTarget(defaults: defaults).href,
			"the next account on the device is prompted for its own share target rather than inheriting this one"
		)
		XCTAssertNil(
			LastViewedReadlist(defaults: defaults).href,
			"and opens on its own readlist rather than one it cannot see"
		)
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
