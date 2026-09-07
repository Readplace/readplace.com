import XCTest
@testable import Readplace

final class LastViewedReadlistTests: XCTestCase {
	func testNothingIsRememberedUntilACollectionLands() {
		XCTAssertNil(
			LastViewedReadlist(defaults: TestSupport.ephemeralDefaults()).href,
			"a first launch has no readlist to open on, so the list starts at the entry point"
		)
	}

	func testARememberedReadlistIsReadBackByAFreshInstance() {
		let defaults = TestSupport.ephemeralDefaults()
		LastViewedReadlist(defaults: defaults).remember(href: "/queue?queue=work")

		XCTAssertEqual(
			LastViewedReadlist(defaults: defaults).href, "/queue?queue=work",
			"the next launch is a new process, so it reads the choice back from the shared suite"
		)
	}

	func testRememberingAgainReplacesTheReadlist() {
		let defaults = TestSupport.ephemeralDefaults()
		let lastViewed = LastViewedReadlist(defaults: defaults)
		lastViewed.remember(href: "/queue?queue=work")

		lastViewed.remember(href: "/queue")

		XCTAssertEqual(
			LastViewedReadlist(defaults: defaults).href, "/queue",
			"the readlist on screen when the app was last used is the one it opens on"
		)
	}

	func testForgettingClearsTheReadlist() {
		let defaults = TestSupport.ephemeralDefaults()
		let lastViewed = LastViewedReadlist(defaults: defaults)
		lastViewed.remember(href: "/queue?queue=work")

		lastViewed.forget()

		XCTAssertNil(
			LastViewedReadlist(defaults: defaults).href,
			"sign-out leaves no readlist behind, so the next account opens at its own entry point"
		)
	}
}
