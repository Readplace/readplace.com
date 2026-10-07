import UIKit
import XCTest
@testable import Readplace

@MainActor
final class BackgroundTimeTests: XCTestCase {
	func testTheApplicationGrantsBackgroundTimeUntilTheDownloadEndsIt() {
		let time = ApplicationBackgroundTime(application: .shared)

		time.begin()
		XCTAssertNotEqual(time.task, .invalid, "a foreground app is granted background time to finish the run")
		time.end()

		XCTAssertEqual(time.task, .invalid, "the time is handed back as soon as the run ends")
	}
}
