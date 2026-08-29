import XCTest
import UIKit
@testable import Readplace

/// Locks `BrandColor` to the web design tokens that are its source of truth. Each
/// value is resolved against an explicit light and dark `UITraitCollection` and
/// checked against the canonical web hex. A dark variant silently copying its light
/// value (or any other drift from the web tokens) fails here rather than shipping the
/// wrong colour on, e.g., the start-screen wordmark.
final class BrandColorTests: XCTestCase {
	func testAmberMirrorsBrandToken() {
		assertHex(BrandColor.amber, light: "#C8702A", dark: "#D4833A")
	}

	func testHighlightMirrorsHighlightToken() {
		assertHex(BrandColor.highlight, light: "#C8923C", dark: "#D4A04A")
	}

	func testSuccessMirrorsSuccessToken() {
		assertHex(BrandColor.success, light: "#3D8B6E", dark: "#4A9F7F")
	}

	func testWarningMirrorsWarningToken() {
		assertHex(BrandColor.warning, light: "#C8923C", dark: "#D4A04A")
	}

	func testErrorMirrorsErrorToken() {
		assertHex(BrandColor.error, light: "#C45C5C", dark: "#D46B6B")
	}

	func testSplashBackgroundMirrorsTheDarkNeutralToken() {
		assertHex(BrandColor.splashBackground, light: "#121212", dark: "#121212")
	}

	func testSurfaceMirrorsBackgroundToken() {
		assertHex(BrandColor.surface, light: "#FFFFFF", dark: "#121212")
	}

	func testSurfaceSubtleMirrorsSurfaceToken() {
		assertHex(BrandColor.surfaceSubtle, light: "#F7F8FA", dark: "#1A1A1A")
	}

	func testTextPrimaryMirrorsTextPrimaryToken() {
		assertHex(BrandColor.textPrimary, light: "#1A202C", dark: "#E4E4E4")
	}

	func testTextSecondaryMirrorsTextSecondaryToken() {
		assertHex(BrandColor.textSecondary, light: "#5A6170", dark: "#9BA1AE")
	}

	func testTextMutedMirrorsTextMutedToken() {
		assertHex(BrandColor.textMuted, light: "#8C919D", dark: "#6B6B6B")
	}

	func testBorderMirrorsBorderToken() {
		assertHex(BrandColor.border, light: "#E2E5EA", dark: "#2E2E2E")
	}

	func testCardMirrorsCardToken() {
		assertHex(BrandColor.card, light: "#FFFFFF", dark: "#222222")
	}

	func testSecondaryMirrorsSecondaryToken() {
		assertHex(BrandColor.secondary, light: "#F6F2EE", dark: "#352D27")
	}

	func testPrimaryTextMirrorsPrimaryTextToken() {
		assertHex(BrandColor.primaryText, light: "#A85A1E", dark: "#DA8D4E")
	}

	func testSuccessTextMirrorsSuccessTextToken() {
		assertHex(BrandColor.successText, light: "#367C63", dark: "#4A9F7F")
	}

	private func assertHex(
		_ color: UIColor,
		light: String,
		dark: String,
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		XCTAssertEqual(hex(color, .light), light, "light", file: file, line: line)
		XCTAssertEqual(hex(color, .dark), dark, "dark", file: file, line: line)
	}

	private func hex(_ color: UIColor, _ style: UIUserInterfaceStyle) -> String {
		let resolved = color.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
		var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
		resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
		return String(
			format: "#%02X%02X%02X",
			Int((red * 255).rounded()),
			Int((green * 255).rounded()),
			Int((blue * 255).rounded())
		)
	}
}
