import CoreGraphics

enum PixelComparison {
	enum Outcome: Equatable {
		case match(ratio: Double)
		case sizeMismatch(baseline: CGSize, rendered: CGSize)
		case tooManyDifferentPixels(ratio: Double, budget: Double, differing: Int, total: Int)
	}

	static let maximumYIQDelta = 35215.0

	static func compare(
		baseline: PixelBitmap,
		rendered: PixelBitmap,
		threshold: Double,
		maxDiffPixelRatio: Double
	) -> Outcome {
		guard baseline.size == rendered.size else {
			return .sizeMismatch(baseline: baseline.size, rendered: rendered.size)
		}

		let budget = maximumYIQDelta * threshold * threshold
		let total = baseline.width * baseline.height
		var differing = 0
		for pixel in 0..<total where colorDelta(baseline.rgba, rendered.rgba, at: pixel * 4) > budget {
			differing += 1
		}

		let ratio = Double(differing) / Double(total)
		guard ratio > maxDiffPixelRatio else { return .match(ratio: ratio) }
		return .tooManyDifferentPixels(
			ratio: ratio,
			budget: maxDiffPixelRatio,
			differing: differing,
			total: total
		)
	}

	private static func colorDelta(_ lhs: [UInt8], _ rhs: [UInt8], at offset: Int) -> Double {
		let r1 = Double(lhs[offset]), g1 = Double(lhs[offset + 1]), b1 = Double(lhs[offset + 2])
		let r2 = Double(rhs[offset]), g2 = Double(rhs[offset + 1]), b2 = Double(rhs[offset + 2])

		let y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2)
		let i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2)
		let q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2)

		return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
	}

	private static func rgb2y(_ r: Double, _ g: Double, _ b: Double) -> Double {
		r * 0.29889531 + g * 0.58662247 + b * 0.11448223
	}

	private static func rgb2i(_ r: Double, _ g: Double, _ b: Double) -> Double {
		r * 0.59597799 - g * 0.27417610 - b * 0.32180189
	}

	private static func rgb2q(_ r: Double, _ g: Double, _ b: Double) -> Double {
		r * 0.21147017 - g * 0.52261711 + b * 0.31114694
	}
}
