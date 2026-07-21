import XCTest
@testable import Readplace

final class IntroMutePreferenceTests: XCTestCase {
	func testUnmutedByDefault() {
		XCTAssertFalse(IntroMutePreference(defaults: TestSupport.ephemeralDefaults()).isMuted)
	}

	func testMutingIsRemembered() {
		let defaults = TestSupport.ephemeralDefaults()
		IntroMutePreference(defaults: defaults).setMuted(true)

		XCTAssertTrue(IntroMutePreference(defaults: defaults).isMuted)
	}

	func testUnmutingIsRemembered() {
		let defaults = TestSupport.ephemeralDefaults()
		let preference = IntroMutePreference(defaults: defaults)
		preference.setMuted(true)

		preference.setMuted(false)

		XCTAssertFalse(IntroMutePreference(defaults: defaults).isMuted)
	}
}
