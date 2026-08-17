import XCTest
@testable import Readplace

final class BackgroundUploadTests: XCTestCase {
	private func identifierOfOurs() -> String {
		"\(BackgroundUpload.sessionIdentifierPrefix)\(UUID().uuidString)"
	}

	// MARK: - The session

	func testIdentifiersCarryingOurPrefixAreOurs() {
		XCTAssertTrue(BackgroundUpload.isUploadSession(identifierOfOurs()))
		XCTAssertTrue(identifierOfOurs().hasPrefix("com.readplace.ShareExtension.upload."))
	}

	func testForeignSessionIdentifiersAreNotOurs() {
		XCTAssertFalse(BackgroundUpload.isUploadSession("com.apple.something.else"))
	}

	func testConfiguresTheSessionToOutliveTheExtension() {
		let identifier = identifierOfOurs()

		let configuration = BackgroundUpload.sessionConfiguration(identifier: identifier, appGroupId: "group.com.readplace")

		XCTAssertEqual(configuration.identifier, identifier)
		XCTAssertEqual(
			configuration.sharedContainerIdentifier, "group.com.readplace",
			"the daemon reads the staged body out of the shared container, so it must be named"
		)
	}

	func testContinuityHeaderMatchesTheOneTheServerReads() {
		// The server drops its "don't close this" notice on exactly this header and
		// value; a rename on either side must fault here rather than in production.
		XCTAssertEqual(AppConfig.saveContinuityHeader, "X-Readplace-Save-Continuity")
		XCTAssertEqual(AppConfig.saveContinuityBackground, "background")
	}

	// MARK: - The app's half

	func testDrainsTheSystemHandlerForASessionThatIsNoneOfOurs() {
		var drained = false

		SharedContainerUploads().resume(sessionIdentifier: "com.apple.something.else", whenDrained: { drained = true })

		XCTAssertTrue(drained, "the system waits on this handler for every session, ours or not")
	}

	func testHoldsTheSystemHandlerUntilOurSessionHasDrained() {
		var drained = false

		SharedContainerUploads().resume(sessionIdentifier: identifierOfOurs(), whenDrained: { drained = true })

		XCTAssertFalse(drained, "our own session is re-attached to first; the handler runs once its events are delivered")
	}
}
