import UIKit
import XCTest
@testable import Readplace

@MainActor
final class BackgroundSessionAppDelegateTests: XCTestCase {

	func testHandsTheSystemsSessionAndHandlerStraightThrough() {
		let events = FakeBackgroundSessionEvents()
		let delegate = BackgroundSessionAppDelegate(events: events)
		var drained = false

		delegate.application(
			UIApplication.shared,
			handleEventsForBackgroundURLSession: "com.readplace.ShareExtension.upload.abc",
			completionHandler: { drained = true }
		)

		XCTAssertEqual(events.resumedIdentifiers, ["com.readplace.ShareExtension.upload.abc"])
		XCTAssertFalse(drained, "the handler belongs to the session, not to the delegate that forwarded it")
		events.drains.first?()
		XCTAssertTrue(drained, "and it is the very handler the system handed over")
	}
}
