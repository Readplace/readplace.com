import CoreGraphics
import XCTest

@testable import Readplace

final class PixelComparisonTests: XCTestCase {
	private static let threshold = CardCheckpoint.threshold
	private static let budget = CardCheckpoint.maxDiffPixelRatio

	func testAnIdenticalRenderMatches() {
		let bitmap = solid(width: 10, height: 10, red: 20, green: 30, blue: 40)

		XCTAssertEqual(
			compare(bitmap, bitmap), .match(ratio: 0),
			"the gate has to pass the picture it was minted from, or no baseline could ever be committed"
		)
	}

	func testADifferentSizeIsDecidedBeforeAnyPixelBudget() {
		let committed = solid(width: 10, height: 10, red: 0, green: 0, blue: 0)
		let taller = solid(width: 10, height: 11, red: 0, green: 0, blue: 0)

		XCTAssertEqual(
			compare(committed, taller),
			.sizeMismatch(baseline: CGSize(width: 10, height: 10), rendered: CGSize(width: 10, height: 11)),
			"a one-pixel metric shift must name both sizes rather than being scored against a budget that assumes they align"
		)
	}

	func testASingleChangedPixelBreaksTheBudget() {
		let committed = solid(width: 10, height: 10, red: 255, green: 255, blue: 255)
		var changed = committed.rgba
		changed[0] = 0
		changed[1] = 0
		changed[2] = 0

		XCTAssertEqual(
			compare(committed, PixelBitmap(width: 10, height: 10, rgba: changed)),
			.tooManyDifferentPixels(ratio: 0.01, budget: Self.budget, differing: 1, total: 100),
			"one pixel in a hundred is two hundred times the budget; a card this small has no room for drift"
		)
	}

	func testAColourShiftTooSmallToSeeIsNotCountedAsADifference() {
		let committed = solid(width: 10, height: 10, red: 200, green: 200, blue: 200)
		let nudged = solid(width: 10, height: 10, red: 201, green: 200, blue: 200)

		XCTAssertEqual(
			compare(committed, nudged), .match(ratio: 0),
			"a single step of rounding in one channel is renderer noise, not a design change"
		)
	}

	func testTheThresholdIsTightEnoughToCatchAFlatRepaintOfTheCard() {
		let committed = solid(width: 10, height: 10, red: 255, green: 255, blue: 255)
		let greyed = solid(width: 10, height: 10, red: 205, green: 205, blue: 205)

		XCTAssertEqual(
			compare(committed, greyed),
			.tooManyDifferentPixels(ratio: 1, budget: Self.budget, differing: 100, total: 100),
			"repainting the card's surface a fifth darker changes no geometry, so only the per-pixel threshold can catch it"
		)
	}

	private func compare(_ baseline: PixelBitmap, _ rendered: PixelBitmap) -> PixelComparison.Outcome {
		PixelComparison.compare(
			baseline: baseline,
			rendered: rendered,
			threshold: Self.threshold,
			maxDiffPixelRatio: Self.budget
		)
	}

	private func solid(width: Int, height: Int, red: UInt8, green: UInt8, blue: UInt8) -> PixelBitmap {
		var rgba: [UInt8] = []
		for _ in 0..<(width * height) {
			rgba.append(contentsOf: [red, green, blue, 255])
		}
		return PixelBitmap(width: width, height: height, rgba: rgba)
	}
}
