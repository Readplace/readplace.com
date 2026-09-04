import SwiftUI
import XCTest
@testable import Readplace

final class AppearancePresentationTests: XCTestCase {
	func testMapsLightAndDarkTokensToTheirColorSchemes() {
		XCTAssertEqual(AppearancePresentation.colorScheme(for: "light"), .light)
		XCTAssertEqual(AppearancePresentation.colorScheme(for: "dark"), .dark)
	}

	func testFollowsTheSystemThemeForSystemUnknownAndAbsentTokens() {
		XCTAssertNil(AppearancePresentation.colorScheme(for: "system"))
		XCTAssertNil(AppearancePresentation.colorScheme(for: "chartreuse"))
		XCTAssertNil(AppearancePresentation.colorScheme(for: nil))
	}
}
