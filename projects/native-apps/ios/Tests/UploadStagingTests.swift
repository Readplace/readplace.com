import XCTest
@testable import Readplace

final class UploadStagingTests: XCTestCase {
	func testRemovesOneBodyByTheNameTheUploadTaskCarries() throws {
		let container = TestSupport.temporaryContainer()
		let staging = UploadStaging(containerURL: container)
		let released = try TestSupport.stagedUploadBody(in: container)
		let survivor = try TestSupport.stagedUploadBody(in: container)

		staging.remove(named: released.lastPathComponent)

		XCTAssertFalse(FileManager.default.fileExists(atPath: released.path))
		XCTAssertTrue(FileManager.default.fileExists(atPath: survivor.path), "only the named body is released")
	}

	func testResolvesStagingInsideTheEntitledAppGroupContainer() throws {
		let container = try XCTUnwrap(
			FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: TokenStore.resolvedAppGroupId),
			"the App Group this build is entitled to must resolve to a container"
		)
		let staging = try XCTUnwrap(UploadStaging.inSharedContainer(appGroupId: TokenStore.resolvedAppGroupId))
		let body = try TestSupport.stagedUploadBody(in: container)

		staging.remove(named: body.lastPathComponent)

		XCTAssertFalse(
			FileManager.default.fileExists(atPath: body.path),
			"the resolved staging must address the same directory the daemon reads bodies out of"
		)
	}

	func testResolvesNoStagingForAnAppGroupThisBuildIsNotEntitledTo() {
		XCTAssertNil(UploadStaging.inSharedContainer(appGroupId: "group.com.readplace.not-entitled"))
	}
}
