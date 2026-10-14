import XCTest
@testable import Readplace

final class AutomaticCaptureAttemptsTests: XCTestCase {
	func testAnArticleIsClaimedForAnAutomaticCaptureOnlyOnce() {
		let attempts = AutomaticCaptureAttempts(defaults: TestSupport.ephemeralDefaults())

		XCTAssertTrue(attempts.claim(articleId: "a1"))
		XCTAssertFalse(
			attempts.claim(articleId: "a1"),
			"a failed article is rescued automatically once per device; after that only a tap retries it"
		)
	}

	func testEachArticleHasItsOwnAttempt() {
		let attempts = AutomaticCaptureAttempts(defaults: TestSupport.ephemeralDefaults())
		XCTAssertTrue(attempts.claim(articleId: "a1"))

		XCTAssertTrue(
			attempts.claim(articleId: "a2"),
			"spending one article's attempt leaves every other article's untouched"
		)
	}

	func testAClaimIsRememberedByTheDeviceNotTheInstance() {
		let defaults = TestSupport.ephemeralDefaults()
		XCTAssertTrue(AutomaticCaptureAttempts(defaults: defaults).claim(articleId: "a1"))

		XCTAssertFalse(
			AutomaticCaptureAttempts(defaults: defaults).claim(articleId: "a1"),
			"a relaunch builds a new instance over the same suite, and must not grant the article a fresh attempt"
		)
	}
}
