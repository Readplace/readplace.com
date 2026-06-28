import XCTest
import UIKit
@testable import Readplace

/// Locks `BrandColor` to the web design tokens it mirrors. Each value is resolved
/// against an explicit light and dark `UITraitCollection` and checked against the
/// hex in `src/packages/web-shell/src/base.styles.ts` — the source of truth. A dark
/// variant silently copying its light value (or any other drift from the web tokens)
/// fails here rather than shipping the wrong colour on, e.g., the start-screen wordmark.
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
