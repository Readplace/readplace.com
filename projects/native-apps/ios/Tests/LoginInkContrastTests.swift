import XCTest
import UIKit
@testable import Readplace

final class LoginInkContrastTests: XCTestCase {
	private let white = UIColor(red: 1, green: 1, blue: 1, alpha: 1)

	func testTheWordmarkTailClearsTheLargeTextFloor() {
		assertClears(floor: 3, ink: LoginInk.wordmarkTail, on: white, element: "The wordmark tail")
	}

	func testTheAuthErrorClearsTheWordFloor() {
		assertClears(floor: 4.5, ink: LoginInk.authError, on: white, element: "The auth error")
	}

	func testTheSignUpLabelClearsTheWordFloorOnItsOwnTint() {
		let fill = composite(light(LoginInk.signUpLabel).withAlphaComponent(0.15), over: white)
		assertClears(floor: 4.5, ink: LoginInk.signUpLabel, on: fill, element: "The Sign up label")
	}

	func testTheSloganAndFooterClearTheWordFloor() {
		assertClears(floor: 4.5, ink: LoginInk.supportingCopy, on: white, element: "The slogan and footer")
	}

	func testTheMuteGlyphClearsTheMarkFloorOnItsDisc() {
		let disc = composite(LoginInk.muteDisc, over: white)
		assertClears(floor: 3, ink: white, on: disc, element: "The mute glyph")
	}

	private func assertClears(
		floor: Double,
		ink: UIColor,
		on ground: UIColor,
		element: String,
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		let colour = contrastRatio(of: ink, on: ground)
		let greyscale = greyscaleRatio(of: ink, on: ground)
		XCTAssertGreaterThanOrEqual(
			colour, floor,
			"\(element) measures \(String(format: "%.2f", colour)):1 in colour, below the \(floor):1 floor",
			file: file, line: line
		)
		XCTAssertGreaterThanOrEqual(
			greyscale, floor,
			"\(element) measures \(String(format: "%.2f", greyscale)):1 in sRGB greyscale, below the \(floor):1 floor",
			file: file, line: line
		)
	}

	private func contrastRatio(of ink: UIColor, on ground: UIColor) -> Double {
		ratio(between: relativeLuminance(of: composite(ink, over: ground)), and: relativeLuminance(of: light(ground)))
	}

	private func greyscaleRatio(of ink: UIColor, on ground: UIColor) -> Double {
		let inkGrey = grey(of: composite(ink, over: ground))
		let groundGrey = grey(of: light(ground))
		return ratio(
			between: relativeLuminance(of: UIColor(red: inkGrey, green: inkGrey, blue: inkGrey, alpha: 1)),
			and: relativeLuminance(of: UIColor(red: groundGrey, green: groundGrey, blue: groundGrey, alpha: 1))
		)
	}

	private func composite(_ ink: UIColor, over ground: UIColor) -> UIColor {
		let top = channels(light(ink))
		let bottom = channels(light(ground))
		let alpha = top.alpha
		return UIColor(
			red: top.red * alpha + bottom.red * (1 - alpha),
			green: top.green * alpha + bottom.green * (1 - alpha),
			blue: top.blue * alpha + bottom.blue * (1 - alpha),
			alpha: 1
		)
	}

	private func light(_ color: UIColor) -> UIColor {
		color.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
	}

	private func channels(_ color: UIColor) -> (red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
		var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
		color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
		return (red, green, blue, alpha)
	}

	private func grey(of color: UIColor) -> CGFloat {
		let rgb = channels(color)
		return 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue
	}

	private func relativeLuminance(of color: UIColor) -> Double {
		let rgb = channels(color)
		func linear(_ value: CGFloat) -> Double {
			let channel = Double(value)
			return channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
		}
		return 0.2126 * linear(rgb.red) + 0.7152 * linear(rgb.green) + 0.0722 * linear(rgb.blue)
	}

	private func ratio(between first: Double, and second: Double) -> Double {
		(max(first, second) + 0.05) / (min(first, second) + 0.05)
	}
}
