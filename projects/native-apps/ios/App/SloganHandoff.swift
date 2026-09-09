import CoreGraphics
import Foundation

struct TextPose: Equatable {
	let opacity: Double
	let scale: Double
	let blur: Double

	static let shown = condensed(0)
	static let hidden = condensed(1)

	static func condensed(_ amount: Double) -> TextPose {
		TextPose(opacity: 1 - amount, scale: 1 - 0.55 * amount, blur: 6 * amount)
	}
}

struct TextPoses: Equatable {
	let outgoing: TextPose
	let incoming: TextPose
}

struct StarHead: Equatable {
	let center: CGPoint
	let coreRadius: Double
	let glowRadius: Double
	let opacity: Double
	let hue: CosmicHue
}

struct SloganComet: Equatable {
	let strokes: [FilamentStroke]
	let head: StarHead?

	static let idle = SloganComet(strokes: [], head: nil)
}

struct CometPath: Equatable {
	let start: CGPoint
	let control: CGPoint
	let end: CGPoint

	init(from start: CGPoint, to end: CGPoint, bow: Double) {
		self.start = start
		self.end = end
		let chordX = end.x - start.x
		let chordY = end.y - start.y
		control = CGPoint(
			x: (start.x + end.x) / 2 - chordY * bow,
			y: (start.y + end.y) / 2 + chordX * bow
		)
	}

	func point(at u: Double) -> CGPoint {
		let v = 1 - u
		return CGPoint(
			x: v * v * start.x + 2 * v * u * control.x + u * u * end.x,
			y: v * v * start.y + 2 * v * u * control.y + u * u * end.y
		)
	}

	func samples(from lower: Double, to upper: Double, count: Int) -> [CGPoint] {
		(0..<count).map { point(at: lower + (upper - lower) * Double($0) / Double(count - 1)) }
	}
}

struct SloganHandoff: Equatable {
	let outgoing: String
	let incoming: String
	let startedAt: TimeInterval
	let ordinal: Int
	let seed: UInt64

	static let collapseSeconds = 0.30
	static let ascentStart = 0.20
	static let flightSeconds = 0.70
	static let drainSeconds = 0.20
	static let landingAt = ascentStart + flightSeconds
	static let descentStart = landingAt + 0.45
	static let arrivalAt = descentStart + flightSeconds
	static let bloomSeconds = 0.45
	static let duration = arrivalAt + bloomSeconds
	private static let tailSpan = 0.35
	private static let bow = 0.28
	private static let coreRadius = 4.5
	private static let glowRadius = 13.0
	private static let bloomRadius = 64.0
	private static let cometOpacity = 0.85
	private static let cometLane = -1

	var hue: CosmicHue {
		CosmicHue.allCases[Int(unit(.hue) * Double(CosmicHue.allCases.count))]
	}

	func landing(sky: CGRect) -> CGPoint {
		CGPoint(
			x: sky.minX + (0.18 + 0.64 * unit(.landingX)) * sky.width,
			y: sky.minY + (0.15 + 0.60 * unit(.landingY)) * sky.height
		)
	}

	func visit(sky: CGRect) -> StarVisit {
		StarVisit(anchor: landing(sky: sky), bornAt: startedAt + Self.landingAt, hue: hue, ordinal: ordinal)
	}

	func poses(at elapsed: TimeInterval) -> TextPoses {
		let t = elapsed - startedAt
		return TextPoses(
			outgoing: .condensed(smoothstep(clamped(t / Self.collapseSeconds))),
			incoming: .condensed(1 - smoothstep(clamped((t - Self.arrivalAt) / Self.bloomSeconds)))
		)
	}

	func comet(at elapsed: TimeInterval, subtitleCenter: CGPoint, sky: CGRect, launch: CGPoint) -> SloganComet {
		let t = elapsed - startedAt
		if t < 0 || t >= Self.duration {
			return .idle
		}
		if t < Self.ascentStart {
			let spark = smoothstep(t / Self.ascentStart)
			return SloganComet(
				strokes: [],
				head: StarHead(
					center: subtitleCenter,
					coreRadius: Self.coreRadius * spark,
					glowRadius: Self.glowRadius * spark,
					opacity: Self.cometOpacity * spark,
					hue: hue
				)
			)
		}
		let bow = unit(.bow) < 0.5 ? -Self.bow : Self.bow
		if t < Self.descentStart {
			let ascent = CometPath(from: subtitleCenter, to: landing(sky: sky), bow: bow)
			return flight(along: ascent, since: t - Self.ascentStart, headFades: true)
		}
		let descent = CometPath(from: launch, to: subtitleCenter, bow: bow)
		let inFlight = flight(along: descent, since: t - Self.descentStart, headFades: false)
		if t < Self.arrivalAt {
			return inFlight
		}
		let bloom = smoothstep((t - Self.arrivalAt) / Self.bloomSeconds)
		return SloganComet(
			strokes: inFlight.strokes,
			head: StarHead(
				center: subtitleCenter,
				coreRadius: Self.coreRadius,
				glowRadius: Self.glowRadius + (Self.bloomRadius - Self.glowRadius) * bloom,
				opacity: Self.cometOpacity * (1 - bloom),
				hue: hue
			)
		)
	}

	private func flight(along path: CometPath, since: Double, headFades: Bool) -> SloganComet {
		let u = smoothstep(min(1, since / Self.flightSeconds))
		let drain = clamped((since - Self.flightSeconds) / Self.drainSeconds)
		let tailStart = max(0, u - Self.tailSpan * (1 - drain))
		let strokes = u > tailStart
			? FilamentStroke.tapered(
				along: path.samples(from: tailStart, to: u, count: FilamentStroke.sampleCount),
				hue: hue,
				lane: Self.cometLane,
				tone: .star,
				coreOpacity: Self.cometOpacity
			)
			: []
		let headOpacity = Self.cometOpacity * (headFades ? 1 - drain : 1)
		let head = headOpacity > 0
			? StarHead(
				center: path.point(at: u),
				coreRadius: Self.coreRadius,
				glowRadius: Self.glowRadius,
				opacity: headOpacity,
				hue: hue
			)
			: nil
		return SloganComet(strokes: strokes, head: head)
	}

	private func clamped(_ x: Double) -> Double {
		min(1, max(0, x))
	}

	private enum Slot: UInt64 {
		case landingX = 1
		case landingY
		case bow
		case hue
	}

	private func unit(_ slot: Slot) -> Double {
		var z = seed
		z ^= UInt64(ordinal) &* 0x9E37_79B9_7F4A_7C15
		z ^= slot.rawValue &* 0xBF58_476D_1CE4_E5B9
		return splitMix64Unit(z)
	}
}
