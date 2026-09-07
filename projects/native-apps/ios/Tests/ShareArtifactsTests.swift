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

	func testForgettingReaderChoicesTakesTheShareTargetAndTheLastViewedReadlist() throws {
		let group = "test.\(UUID().uuidString)"
		let defaults = try XCTUnwrap(
			UserDefaults(suiteName: group),
			"the App Group a sign-out clears must resolve to a defaults suite"
		)
		defer { defaults.removePersistentDomain(forName: group) }
		ShareTarget(defaults: defaults).record(hrefs: ["/queue?queue=work"])
		LastViewedReadlist(defaults: defaults).remember(href: "/queue?queue=work")

		ShareArtifacts.forgetReaderChoices(appGroupId: group)

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, [],
			"the next account on the device is prompted for its own share target rather than inheriting this one"
		)
		XCTAssertNil(
			LastViewedReadlist(defaults: defaults).href,
			"and opens on its own readlist rather than one it cannot see"
		)
	}

	func testPurgingSessionArtifactsLeavesTheReadersChoicesAlone() throws {
		let group = TokenStore.resolvedAppGroupId
		let defaults = try XCTUnwrap(UserDefaults(suiteName: group))
		ShareArtifacts.forgetReaderChoices(appGroupId: group)
		ShareTarget(defaults: defaults).record(hrefs: ["/queue?queue=work"])
		LastViewedReadlist(defaults: defaults).remember(href: "/queue?queue=work")

		ShareArtifacts.purge(appGroupId: group)

		XCTAssertEqual(
			ShareTarget(defaults: defaults).hrefs, ["/queue?queue=work"],
			"a session that expired on its own is the same reader coming back, so where their shares drop must survive it"
		)
		XCTAssertEqual(
			LastViewedReadlist(defaults: defaults).href, "/queue?queue=work",
			"and the readlist they were reading is still theirs"
		)
		ShareArtifacts.forgetReaderChoices(appGroupId: group)
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
