import XCTest
@testable import Readplace

final class OfflineCopyTests: XCTestCase {
	private let now = Date(timeIntervalSince1970: 1_791_158_400)

	func testACopyTheServerDatedWithinThirtyDaysIsShown() {
		XCTAssertEqual(OfflineCopy.isShowable(dateHeader: "Sun, 04 Oct 2026 00:00:00 GMT", now: now), true)
	}

	func testACopyDatedExactlyThirtyDaysAgoIsStillShown() {
		XCTAssertEqual(OfflineCopy.isShowable(dateHeader: "Sat, 05 Sep 2026 00:00:00 GMT", now: now), true)
	}

	func testACopyDatedMoreThanThirtyDaysAgoIsNotShown() {
		XCTAssertEqual(
			OfflineCopy.isShowable(dateHeader: "Fri, 04 Sep 2026 23:59:59 GMT", now: now), false,
			"a copy the server has not confirmed for thirty days is never shown, so no stored copy is permanent"
		)
	}

	func testACopyWithNoDateIsNotShown() {
		XCTAssertEqual(
			OfflineCopy.isShowable(dateHeader: nil, now: now), false,
			"a copy whose age cannot be told could otherwise be shown forever"
		)
	}

	func testACopyWithAnUnreadableDateIsNotShown() {
		XCTAssertEqual(OfflineCopy.isShowable(dateHeader: "yesterday", now: now), false)
	}
}
