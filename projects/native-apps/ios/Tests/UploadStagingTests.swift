import XCTest
@testable import Readplace

final class UploadStagingTests: XCTestCase {
	private func makeStaging() -> UploadStaging {
		UploadStaging(containerURL: TestSupport.temporaryContainer())
	}

	func testStagesTheFormBodyUnderTheContainersCaches() async throws {
		let staging = makeStaging()
		let form = TestSupport.multipartForm(content: Data("<html>hi</html>".utf8))

		let file = try await staging.stage(form)

		XCTAssertEqual(file.pathExtension, "multipart")
		XCTAssertEqual(
			file.deletingLastPathComponent().pathComponents.suffix(3).joined(separator: "/"),
			"Library/Caches/share-uploads",
			"the body must land in the shared container's caches, where the system daemon can still read it"
		)
		let parts = TestSupport.multipartParts(contentType: form.contentType, body: try Data(contentsOf: file))
		XCTAssertEqual(parts.first { $0.name == "content" }?.text, "<html>hi</html>")
	}

	func testStagesEachBodyUnderItsOwnName() async throws {
		let staging = makeStaging()

		let first = try await staging.stage(TestSupport.multipartForm())
		let second = try await staging.stage(TestSupport.multipartForm())

		XCTAssertNotEqual(first.lastPathComponent, second.lastPathComponent)
		XCTAssertTrue(FileManager.default.fileExists(atPath: first.path), "a second save must not clobber the first body")
	}

	func testDoesItsFileWorkWhileTheMainThreadIsBusy() async throws {
		// The share sheet stages while its own sheet is animating, so neither the scan
		// nor the write may belong to the main actor: both have to finish with the main
		// thread held busy. Observed from a detached task so the check itself is off it.
		let staging = makeStaging()
		let mainReleased = LockedFlag()
		DispatchQueue.main.async {
			Thread.sleep(forTimeInterval: 0.5)
			mainReleased.set()
		}

		let staged = try await Task.detached {
			let file = try await staging.stage(TestSupport.multipartForm())
			return (file: file, mainStillBusy: !mainReleased.value)
		}.value

		XCTAssertTrue(FileManager.default.fileExists(atPath: staged.file.path))
		XCTAssertTrue(staged.mainStillBusy, "the staging waited for the main thread, so it is doing its file work on it")
	}

	func testRemovesOneBodyByTheNameTheUploadTaskCarries() async throws {
		let staging = makeStaging()
		let file = try await staging.stage(TestSupport.multipartForm())
		let survivor = try await staging.stage(TestSupport.multipartForm())

		staging.remove(named: file.lastPathComponent)

		XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
		XCTAssertTrue(FileManager.default.fileExists(atPath: survivor.path), "only the named body is released")
	}

	func testResolvesStagingInsideTheEntitledAppGroupContainer() async throws {
		let staging = try XCTUnwrap(
			UploadStaging.inSharedContainer(appGroupId: TokenStore.resolvedAppGroupId),
			"the App Group this build is entitled to must resolve to a container"
		)

		let file = try await staging.stage(TestSupport.multipartForm())
		defer { staging.remove(named: file.lastPathComponent) }

		XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
	}

	func testResolvesNoStagingForAnAppGroupThisBuildIsNotEntitledTo() {
		XCTAssertNil(UploadStaging.inSharedContainer(appGroupId: "group.com.readplace.not-entitled"))
	}
}

/// A flag one thread sets and another reads, so the off-the-main-actor check
/// above is not itself a data race.
private final class LockedFlag: @unchecked Sendable {
	private let lock = NSLock()
	private var flag = false

	var value: Bool {
		lock.lock(); defer { lock.unlock() }
		return flag
	}

	func set() {
		lock.lock(); defer { lock.unlock() }
		flag = true
	}
}
