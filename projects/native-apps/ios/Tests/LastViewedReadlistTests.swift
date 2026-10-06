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

	func testTheLandingTabIsRememberedBesideTheReadlist() {
		let defaults = TestSupport.ephemeralDefaults()
		LastViewedReadlist(defaults: defaults).remember(landingTabHref: "/queue?queue=work&status=unread")

		XCTAssertEqual(
			LastViewedReadlist(defaults: defaults).landingTabHref, "/queue?queue=work&status=unread",
			"the next launch opens on the tab whose stored copy every later read refreshed"
		)
	}

	func testAReadlistWithoutTabsLeavesNoLandingTabBehind() {
		let defaults = TestSupport.ephemeralDefaults()
		let lastViewed = LastViewedReadlist(defaults: defaults)
		lastViewed.remember(landingTabHref: "/queue?status=unread")

		lastViewed.remember(landingTabHref: nil)

		XCTAssertNil(LastViewedReadlist(defaults: defaults).landingTabHref, "a landing tab from another readlist is never reused")
	}

	func testForgettingClearsTheLandingTab() {
		let defaults = TestSupport.ephemeralDefaults()
		let lastViewed = LastViewedReadlist(defaults: defaults)
		lastViewed.remember(landingTabHref: "/queue?queue=work&status=unread")

		lastViewed.forget()

		XCTAssertNil(LastViewedReadlist(defaults: defaults).landingTabHref)
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
