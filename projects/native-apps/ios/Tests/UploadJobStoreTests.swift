import XCTest
@testable import Readplace

final class UploadJobStoreTests: XCTestCase {
	private static let epoch = Date(timeIntervalSince1970: 1_000_000)

	private func makeStore() -> UploadJobStore {
		UploadJobStore(containerURL: TestSupport.temporaryContainer())
	}

	private func job(
		id: String,
		url: String = "https://example.com/post",
		createdAt: Date = UploadJobStoreTests.epoch,
		nextAttemptAt: Date = UploadJobStoreTests.epoch
	) -> UploadJob {
		UploadJob(
			id: id,
			url: url,
			title: "A Title",
			state: .capturePending(detectedMediaType: nil),
			attempts: 0,
			nextAttemptAt: nextAttemptAt,
			createdAt: createdAt
		)
	}

	// MARK: - Admitting

	func testAdmitsAJobUnderTheContainersApplicationSupport() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")

		try await store.admit(admitted)

		XCTAssertEqual(store.loadAll(now: Self.epoch), [admitted])
		XCTAssertEqual(
			store.bytesURL(for: admitted).deletingLastPathComponent().pathComponents.suffix(3).joined(separator: "/"),
			"Library/Application Support/upload-queue",
			"a queued upload is a durable promise, so it must sit where the system does not purge it"
		)
	}

	func testSupersedesAnEarlierJobForTheSameLink() async throws {
		let store = makeStore()
		let first = job(id: "j1", url: "https://example.com/post")
		try await store.admit(first)
		let staged = try await store.stageReady(first, form: TestSupport.multipartForm())
		let other = job(id: "j3", url: "https://example.com/other", createdAt: Self.epoch.addingTimeInterval(2))
		try await store.admit(other)

		let second = job(id: "j2", url: "https://example.com/post", createdAt: Self.epoch.addingTimeInterval(1))
		try await store.admit(second)

		XCTAssertEqual(store.loadAll(now: Self.epoch.addingTimeInterval(2)).map(\.id), ["j2", "j3"])
		XCTAssertFalse(
			FileManager.default.fileExists(atPath: store.bytesURL(for: staged).path),
			"the superseded job's staged body goes with its record"
		)
	}

	// MARK: - Staging

	func testStagesTheBodyThenFlipsTheRecordToReady() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")
		try await store.admit(admitted)
		let form = TestSupport.multipartForm(content: Data("<html>hi</html>".utf8))

		let ready = try await store.stageReady(admitted, form: form)

		XCTAssertEqual(ready.state, .ready(contentType: form.contentType))
		XCTAssertEqual(store.loadAll(now: Self.epoch), [ready])
		let parts = TestSupport.multipartParts(
			contentType: form.contentType,
			body: try Data(contentsOf: store.bytesURL(for: ready))
		)
		XCTAssertEqual(parts.first { $0.name == "content" }?.text, "<html>hi</html>")
	}

	func testLeavesTheRecordPendingWhenItsBodyCannotBeStaged() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")
		try await store.admit(admitted)
		try FileManager.default.createDirectory(at: store.bytesURL(for: admitted), withIntermediateDirectories: true)

		do {
			_ = try await store.stageReady(admitted, form: TestSupport.multipartForm())
			XCTFail("a body that could not be written must not produce a ready record")
		} catch {
			XCTAssertEqual(
				store.loadAll(now: Self.epoch).map(\.state), [.capturePending(detectedMediaType: nil)],
				"the bytes land before the record, so a ready record always finds its body"
			)
		}
	}

	func testResurrectsNothingWhenStagingIntoAPurgedQueue() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")
		try await store.admit(admitted)
		store.purgeAll()

		do {
			_ = try await store.stageReady(admitted, form: TestSupport.multipartForm())
			XCTFail("staging into a purged queue must throw rather than re-create it")
		} catch {
			XCTAssertEqual(
				store.loadAll(now: Self.epoch), [],
				"a sign-out purge is final: an in-flight capture must not write the queue back into being"
			)
			XCTAssertFalse(FileManager.default.fileExists(atPath: store.bytesURL(for: admitted).path))
		}
	}

	// MARK: - Loading

	func testLoadsDueJobsOldestFirst() async throws {
		let store = makeStore()
		let newer = job(id: "j2", url: "https://example.com/two", createdAt: Self.epoch.addingTimeInterval(60))
		let older = job(id: "j1", url: "https://example.com/one", createdAt: Self.epoch)
		try await store.admit(newer)
		try await store.admit(older)

		XCTAssertEqual(store.loadAll(now: Self.epoch).map(\.id), ["j1", "j2"])
	}

	func testHoldsBackAJobWhoseNextAttemptHasNotArrived() async throws {
		let store = makeStore()
		let waiting = job(id: "j1", nextAttemptAt: Self.epoch.addingTimeInterval(60))
		try await store.admit(waiting)

		XCTAssertEqual(store.loadAll(now: Self.epoch), [])
		XCTAssertEqual(store.loadAll(now: Self.epoch.addingTimeInterval(60)), [waiting])
	}

	func testDropsAMalformedRecordAndKeepsTheRest() async throws {
		let store = makeStore()
		let survivor = job(id: "j1")
		try await store.admit(survivor)
		let queue = store.bytesURL(for: survivor).deletingLastPathComponent()
		try Data("{ not a record".utf8).write(to: queue.appendingPathComponent("broken.json"))

		XCTAssertEqual(store.loadAll(now: Self.epoch), [survivor])
	}

	// MARK: - Updating and removing

	func testUpdateRewritesTheRecordInPlace() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")
		try await store.admit(admitted)
		let retried = try XCTUnwrap(admitted.retried(now: Self.epoch))

		try store.update(retried)

		XCTAssertEqual(store.loadAll(now: Self.epoch.addingTimeInterval(60)), [retried])
	}

	func testRemoveDeletesTheRecordAndItsStagedBody() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")
		try await store.admit(admitted)
		let ready = try await store.stageReady(admitted, form: TestSupport.multipartForm())
		let survivor = job(id: "j2", url: "https://example.com/other")
		try await store.admit(survivor)

		store.remove(ready)

		XCTAssertEqual(store.loadAll(now: Self.epoch), [survivor])
		XCTAssertFalse(FileManager.default.fileExists(atPath: store.bytesURL(for: ready).path))
	}

	func testSweepsBytesLeftBehindWithoutTheirRecord() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")
		try await store.admit(admitted)
		let ready = try await store.stageReady(admitted, form: TestSupport.multipartForm())
		let orphan = store.bytesURL(for: job(id: "gone"))
		try Data("stale body".utf8).write(to: orphan)

		store.removeOrphanedBytes()

		XCTAssertTrue(FileManager.default.fileExists(atPath: store.bytesURL(for: ready).path))
		XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path))
	}

	func testPurgeAllEmptiesTheQueue() async throws {
		let store = makeStore()
		let admitted = job(id: "j1")
		try await store.admit(admitted)
		_ = try await store.stageReady(admitted, form: TestSupport.multipartForm())

		store.purgeAll()

		XCTAssertEqual(store.loadAll(now: Self.epoch), [])
		XCTAssertFalse(FileManager.default.fileExists(atPath: store.bytesURL(for: admitted).path))
	}

	// MARK: - Shared container

	func testResolvesTheQueueInsideTheEntitledAppGroupContainer() async throws {
		let store = try XCTUnwrap(
			UploadJobStore.inSharedContainer(appGroupId: TokenStore.resolvedAppGroupId),
			"the App Group this build is entitled to must resolve to a container"
		)
		let admitted = job(id: UUID().uuidString, url: "https://example.com/\(UUID().uuidString)")

		try await store.admit(admitted)
		defer { store.remove(admitted) }

		XCTAssertEqual(store.loadAll(now: Self.epoch).filter { $0.id == admitted.id }, [admitted])
	}

	func testResolvesNoQueueForAnAppGroupThisBuildIsNotEntitledTo() {
		XCTAssertNil(UploadJobStore.inSharedContainer(appGroupId: "group.com.readplace.not-entitled"))
	}
}
