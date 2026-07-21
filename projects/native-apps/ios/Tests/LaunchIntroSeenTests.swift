import XCTest
@testable import Readplace

final class LaunchIntroSeenTests: XCTestCase {
	func testTheFirstClaimSucceeds() {
		let seen = LaunchIntroSeen(defaults: TestSupport.ephemeralDefaults())

		XCTAssertTrue(seen.claim())
	}

	func testASecondClaimOnTheSameSuiteFails() {
		let defaults = TestSupport.ephemeralDefaults()
		let seen = LaunchIntroSeen(defaults: defaults)

		XCTAssertTrue(seen.claim())
		XCTAssertFalse(seen.claim(), "the intro must play only once per install")
	}

	func testAFreshSuiteClaimsAgain() {
		XCTAssertTrue(LaunchIntroSeen(defaults: TestSupport.ephemeralDefaults()).claim())
		XCTAssertTrue(LaunchIntroSeen(defaults: TestSupport.ephemeralDefaults()).claim())
	}
}
