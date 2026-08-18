import XCTest
@testable import Readplace

final class UnseenSaveTests: XCTestCase {
	// MARK: - Shared container

	func testResolvesTheMarkerInsideTheEntitledAppGroupContainer() throws {
		let unseenSave = try XCTUnwrap(
			UnseenSave.inSharedContainer(appGroupId: TokenStore.resolvedAppGroupId),
			"the App Group this build is entitled to must resolve to a container"
		)
		defer { unseenSave.clear() }

		unseenSave.record()

		XCTAssertTrue(unseenSave.exists, "the recorded save is visible through the shared container")
	}

	func testResolvesNoMarkerForAnAppGroupThisBuildIsNotEntitledTo() {
		XCTAssertNil(UnseenSave.inSharedContainer(appGroupId: "group.com.readplace.not-entitled"))
	}
}
