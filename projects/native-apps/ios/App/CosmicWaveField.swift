import CoreGraphics
import Foundation
import SwiftUI
import UIKit

enum CosmicHue: CaseIterable {
	case amberHighlight
	case deepAmber
	case violet
	case cyan
	case magenta

	private var variants: (light: HueVariant, dark: HueVariant) {
		switch self {
		case .amberHighlight:
			return (
				light: HueVariant(red: 200, green: 146, blue: 60, alpha: 0.20),
				dark: HueVariant(red: 212, green: 160, blue: 74, alpha: 0.28)
			)
		case .deepAmber:
			return (
				light: HueVariant(red: 200, green: 112, blue: 42, alpha: 0.18),
				dark: HueVariant(red: 212, green: 131, blue: 58, alpha: 0.26)
			)
		case .violet:
			return (
				light: HueVariant(red: 108, green: 66, blue: 158, alpha: 0.15),
				dark: HueVariant(red: 168, green: 128, blue: 214, alpha: 0.22)
			)
		case .cyan:
			return (
				light: HueVariant(red: 74, green: 127, blue: 181, alpha: 0.14),
				dark: HueVariant(red: 122, green: 178, blue: 222, alpha: 0.20)
			)
		case .magenta:
			return (
				light: HueVariant(red: 176, green: 68, blue: 122, alpha: 0.13),
				dark: HueVariant(red: 222, green: 130, blue: 178, alpha: 0.18)
			)
		}
	}

	var uiColor: UIColor {
		dynamicColor(light: variants.light, dark: variants.dark)
	}

	var color: Color { Color(uiColor: uiColor) }

	var starUIColor: UIColor {
		dynamicColor(light: variants.light.opaque, dark: variants.dark.opaque)
	}

	var starColor: Color { Color(uiColor: starUIColor) }
}

private struct HueVariant {
	let red: Int
	let green: Int
	let blue: Int
	let alpha: Double

	var opaque: HueVariant {
		HueVariant(red: red, green: green, blue: blue, alpha: 1)
	}
}

private func dynamicColor(light: HueVariant, dark: HueVariant) -> UIColor {
	UIColor { trait in
		let variant = trait.userInterfaceStyle == .dark ? dark : light
		return UIColor(
			red: CGFloat(variant.red) / 255,
			green: CGFloat(variant.green) / 255,
			blue: CGFloat(variant.blue) / 255,
			alpha: CGFloat(variant.alpha)
		)
	}
}

struct EdgeFade: Equatable {
	let leadIn: Double
	let leadOut: Double
}

enum CosmicZone {
	case aboveBrand
	case belowActions

	var horizontalFade: EdgeFade { EdgeFade(leadIn: 0.10, leadOut: 0.10) }

	var verticalFade: EdgeFade {
		switch self {
		case .aboveBrand: return EdgeFade(leadIn: 0.06, leadOut: 0.10)
		case .belowActions: return EdgeFade(leadIn: 0.12, leadOut: 0.12)
		}
	}

	fileprivate var salt: UInt64 {
		switch self {
		case .aboveBrand: return 0
		case .belowActions: return 1
		}
	}

	fileprivate var filaments: [FilamentSlot] {
		switch self {
		case .aboveBrand:
			return [
				FilamentSlot(hue: .amberHighlight, band: 0.105...0.135),
				FilamentSlot(hue: .cyan, band: 0.285...0.315),
				FilamentSlot(hue: .magenta, band: 0.465...0.495),
				FilamentSlot(hue: .violet, band: 0.645...0.675),
				FilamentSlot(hue: .deepAmber, band: 0.825...0.855),
			]
		case .belowActions:
			return [
				FilamentSlot(hue: .violet, band: 0.185...0.215),
				FilamentSlot(hue: .deepAmber, band: 0.485...0.515),
				FilamentSlot(hue: .cyan, band: 0.785...0.815),
			]
		}
	}

	fileprivate var spanScale: Double {
		switch self {
		case .aboveBrand: return 1.0
		case .belowActions: return 0.6
		}
	}

	fileprivate var opacityScale: Double {
		switch self {
		case .aboveBrand: return 1.0
		case .belowActions: return 0.8
		}
	}

	fileprivate func startOffset(filament: Int) -> Double {
		switch self {
		case .aboveBrand: return 0.31 * Double(filament)
		case .belowActions: return 0.17 + 0.43 * Double(filament)
		}
	}
}

fileprivate struct FilamentSlot {
	let hue: CosmicHue
	let band: ClosedRange<Double>
}

struct WaveClock: Equatable {
	let accumulated: TimeInterval
	let resumedAt: Date?

	func elapsed(at date: Date) -> TimeInterval {
		accumulated + (resumedAt.map { max(0, date.timeIntervalSince($0)) } ?? 0)
	}

	func pausing(at date: Date) -> WaveClock {
		guard let resumedAt else { return self }
		return WaveClock(accumulated: accumulated + max(0, date.timeIntervalSince(resumedAt)), resumedAt: nil)
	}

	func resuming(at date: Date) -> WaveClock {
		resumedAt == nil ? WaveClock(accumulated: accumulated, resumedAt: date) : self
	}
}

enum StrokeTone: Equatable {
	case veil
	case star
}

struct FilamentStroke: Equatable {
	let points: [CGPoint]
	let hue: CosmicHue
	let lane: Int
	let tone: StrokeTone
	let opacity: Double
	let lineWidth: Double
	let blurRadius: Double
}

extension FilamentStroke {
	static let segmentCount = 8
	static let pointsPerSegment = 10
	static let sampleCount = segmentCount * pointsPerSegment + 1
	private static let tailFalloff = 0.9
	private static let tailMinThickness = 0.72
	private static let glowOpacityFactor = 0.5
	private static let coreLineWidth = 2.3
	private static let glowLineWidth = 7.6
	private static let coreBlurRadius = 0.0
	private static let glowBlurRadius = 6.0

	static func tapered(
		along points: [CGPoint],
		hue: CosmicHue,
		lane: Int,
		tone: StrokeTone,
		coreOpacity: Double
	) -> [FilamentStroke] {
		assert(points.count == sampleCount, "a tapered polyline carries exactly \(sampleCount) samples")
		return (0..<segmentCount).flatMap { segment -> [FilamentStroke] in
			let start = segment * pointsPerSegment
			let segmentPoints = Array(points[start...start + pointsPerSegment])
			let alongTail = (Double(segment) + 0.5) / Double(segmentCount)
			let brightness = pow(alongTail, tailFalloff)
			let thickness = tailMinThickness + (1 - tailMinThickness) * alongTail
			let core = coreOpacity * brightness
			return [
				FilamentStroke(
					points: segmentPoints,
					hue: hue,
					lane: lane,
					tone: tone,
					opacity: glowOpacityFactor * core,
					lineWidth: glowLineWidth * thickness,
					blurRadius: glowBlurRadius
				),
				FilamentStroke(
					points: segmentPoints,
					hue: hue,
					lane: lane,
					tone: tone,
					opacity: core,
					lineWidth: coreLineWidth * thickness,
					blurRadius: coreBlurRadius
				),
			]
		}
	}
}

struct StarVisit: Equatable {
	let anchor: CGPoint
	let bornAt: TimeInterval
	let hue: CosmicHue
	let ordinal: Int
}

fileprivate struct BoltShape {
	let filament: Int
	let generation: Int
	let anchor: CGPoint
	let hue: CosmicHue
	let lane: Int
}

func smoothstep(_ x: Double) -> Double {
	x * x * (3 - 2 * x)
}

func splitMix64Unit(_ seed: UInt64) -> Double {
	var z = seed
	z ^= z >> 30
	z = z &* 0xBF58_476D_1CE4_E5B9
	z ^= z >> 27
	z = z &* 0x94D0_49BB_1331_11EB
	z ^= z >> 31
	return Double(z >> 40) / Double(1 << 24)
}

private struct Vector3 {
	let x: Double
	let y: Double
	let z: Double

	func dot(_ other: Vector3) -> Double {
		x * other.x + y * other.y + z * other.z
	}

	func scaled(_ factor: Double) -> Vector3 {
		Vector3(x: x * factor, y: y * factor, z: z * factor)
	}

	func adding(_ other: Vector3) -> Vector3 {
		Vector3(x: x + other.x, y: y + other.y, z: z + other.z)
	}

	func subtracting(_ other: Vector3) -> Vector3 {
		Vector3(x: x - other.x, y: y - other.y, z: z - other.z)
	}

	func normalized() -> Vector3 {
		scaled(1 / (dot(self)).squareRoot())
	}

}

struct CosmicWaveField {
	let seed: UInt64
	let zone: CosmicZone

	private static let samplesPerFilament = FilamentStroke.sampleCount
	private static let drawSeconds = 0.32
	private static let minKinks = 2
	private static let maxKinks = 6
	private static let kinkAmplitudeBase = 7.0
	private static let kinkAmplitudeJitter = 9.0
	private static let fadeOutSeconds = 0.5
	private static let breathPeriodSeconds = 1.6
	private static let tangentTiltRange = 0.30
	private static let spanBase = 0.055
	private static let spanJitter = 0.040
	private static let staticOpacityFactor = 0.7
	private static let sphereScopeFilament = 1000
	private static let visitFilamentBase = 100
	private static let visitLaneBase = 100
	private static let visitLifetimeSeconds = 2.4
	private static let visitSettleSeconds = 0.6

	func strokes(
		zoneFrame: CGRect,
		screenSize: CGSize,
		elapsed: TimeInterval,
		visits: [StarVisit]
	) -> [FilamentStroke] {
		guard zoneFrame.width > 0, zoneFrame.height > 0, screenSize.width > 0, screenSize.height > 0 else { return [] }
		let lanes = zone.filaments.indices.flatMap { index in
			animatedStrokes(filament: index, zoneFrame: zoneFrame, screenSize: screenSize, elapsed: elapsed)
		}
		let guests = visits.flatMap { visit in
			visitStrokes(visit, zoneFrame: zoneFrame, screenSize: screenSize, elapsed: elapsed)
		}
		return lanes + guests
	}

	func staticStrokes(zoneFrame: CGRect, screenSize: CGSize) -> [FilamentStroke] {
		guard zoneFrame.width > 0, zoneFrame.height > 0, screenSize.width > 0, screenSize.height > 0 else { return [] }
		return zone.filaments.indices.flatMap { index -> [FilamentStroke] in
			segmentStrokes(
				bolt: laneBolt(filament: index, generation: 0, zoneFrame: zoneFrame),
				zoneFrame: zoneFrame,
				screenSize: screenSize,
				sinceBirth: Self.drawSeconds,
				coreOpacity: Self.staticOpacityFactor * zone.opacityScale,
				tone: .veil
			)
		}
	}

	func visitHead(_ visit: StarVisit, zoneFrame: CGRect, screenSize: CGSize) -> CGPoint {
		let points = arcPoints(
			bolt: visitBolt(visit),
			zoneFrame: zoneFrame,
			screenSize: screenSize,
			sinceBirth: Self.drawSeconds
		)
		let visible = CGRect(origin: .zero, size: zoneFrame.size)
		var tip = points[0]
		for point in points.dropFirst() {
			guard visible.contains(point) else { break }
			tip = point
		}
		return CGPoint(x: tip.x + zoneFrame.minX, y: tip.y + zoneFrame.minY)
	}

	private func animatedStrokes(
		filament index: Int,
		zoneFrame: CGRect,
		screenSize: CGSize,
		elapsed: TimeInterval
	) -> [FilamentStroke] {
		let localElapsed = elapsed - zone.startOffset(filament: index)
		guard localElapsed >= 0 else { return [] }
		let period = cyclePeriod(filament: index)
		let generation = Int(localElapsed / period)
		let cyclePhase = localElapsed - Double(generation) * period
		let sinceBirth = cyclePhase - gap(filament: index, generation: generation)
		guard sinceBirth > 0 else { return [] }
		let opacity = veilOpacity(filament: index, generation: generation, phase: cyclePhase, period: period)
		return segmentStrokes(
			bolt: laneBolt(filament: index, generation: generation, zoneFrame: zoneFrame),
			zoneFrame: zoneFrame,
			screenSize: screenSize,
			sinceBirth: sinceBirth,
			coreOpacity: opacity,
			tone: .veil
		)
	}

	private func visitStrokes(
		_ visit: StarVisit,
		zoneFrame: CGRect,
		screenSize: CGSize,
		elapsed: TimeInterval
	) -> [FilamentStroke] {
		let sinceBirth = elapsed - visit.bornAt
		guard sinceBirth > 0, sinceBirth < Self.visitLifetimeSeconds else { return [] }
		let bolt = visitBolt(visit)
		let opacity = veilOpacity(
			filament: bolt.filament,
			generation: bolt.generation,
			phase: sinceBirth,
			period: Self.visitLifetimeSeconds
		)
		let veil = segmentStrokes(
			bolt: bolt,
			zoneFrame: zoneFrame,
			screenSize: screenSize,
			sinceBirth: sinceBirth,
			coreOpacity: opacity,
			tone: .veil
		)
		let settling = 1 - smoothstep(min(1, sinceBirth / Self.visitSettleSeconds))
		guard settling > 0 else { return veil }
		return veil + segmentStrokes(
			bolt: bolt,
			zoneFrame: zoneFrame,
			screenSize: screenSize,
			sinceBirth: sinceBirth,
			coreOpacity: opacity * settling,
			tone: .star
		)
	}

	private func laneBolt(filament index: Int, generation: Int, zoneFrame: CGRect) -> BoltShape {
		let band = zone.filaments[index].band
		let anchor = CGPoint(
			x: zoneFrame.minX + (0.15 + 0.7 * unit(filament: index, generation: generation, slot: .anchorX)) * zoneFrame.width,
			y: zoneFrame.minY
				+ (band.lowerBound + unit(filament: index, generation: generation, slot: .anchorY) * (band.upperBound - band.lowerBound))
				* zoneFrame.height
		)
		return BoltShape(filament: index, generation: generation, anchor: anchor, hue: zone.filaments[index].hue, lane: index)
	}

	private func visitBolt(_ visit: StarVisit) -> BoltShape {
		BoltShape(
			filament: Self.visitFilamentBase + visit.ordinal,
			generation: 0,
			anchor: visit.anchor,
			hue: visit.hue,
			lane: Self.visitLaneBase + visit.ordinal
		)
	}

	private func segmentStrokes(
		bolt: BoltShape,
		zoneFrame: CGRect,
		screenSize: CGSize,
		sinceBirth: Double,
		coreOpacity: Double,
		tone: StrokeTone
	) -> [FilamentStroke] {
		FilamentStroke.tapered(
			along: arcPoints(bolt: bolt, zoneFrame: zoneFrame, screenSize: screenSize, sinceBirth: sinceBirth),
			hue: bolt.hue,
			lane: bolt.lane,
			tone: tone,
			coreOpacity: coreOpacity
		)
	}

	private func arcPoints(
		bolt: BoltShape,
		zoneFrame: CGRect,
		screenSize: CGSize,
		sinceBirth: Double
	) -> [CGPoint] {
		let index = bolt.filament
		let generation = bolt.generation
		let sphere = sphereGeometry(screenSize: screenSize)
		let anchor = bolt.anchor
		let focal = 2.4 * sphere.radius
		let offsetX = anchor.x - sphere.center.x
		let offsetY = anchor.y - sphere.center.y
		let planar = offsetX * offsetX + offsetY * offsetY
		let focalSquared = focal * focal
		let radiusSquared = sphere.radius * sphere.radius
		let discriminant = focalSquared * radiusSquared - planar * (focalSquared - radiusSquared)
		let unprojection = (focalSquared - discriminant.squareRoot()) / (planar + focalSquared)
		let anchor3D = Vector3(x: offsetX * unprojection, y: offsetY * unprojection, z: focal * (1 - unprojection))
		let tilt = (unit(filament: index, generation: generation, slot: .tangentTilt) - 0.5) * Self.tangentTiltRange
		let heading = Vector3(x: cos(tilt), y: sin(tilt), z: 0)
		// The bolt rides the great circle through its anchor, so the plane it turns
		// in is spanned by the anchor itself and a tangent square to it.
		let radialUnit = anchor3D.normalized()
		let tangent = heading.subtracting(radialUnit.scaled(heading.dot(radialUnit))).normalized()
		let direction: Double = unit(filament: index, generation: 0, slot: .driftDirection) < 0.5 ? -1 : 1
		let span = direction
			* (Self.spanBase + Self.spanJitter * unit(filament: index, generation: generation, slot: .span))
			* zone.spanScale
		// Both ends of the bolt are fixed for its whole life: the drawn fraction
		// reveals a path that never moves, so nothing trails or whips behind.
		let drawn = min(1, sinceBirth / Self.drawSeconds)
		let step = span * drawn / Double(Self.samplesPerFilament - 1)
		let kinks = Self.minKinks + Int(unit(filament: index, generation: generation, slot: .kinkCount) * Double(Self.maxKinks - Self.minKinks + 1))
		let kinkAmplitude = (Self.kinkAmplitudeBase + Self.kinkAmplitudeJitter * unit(filament: index, generation: generation, slot: .amplitudeJitter))
			* zone.spanScale
		return (0..<Self.samplesPerFilament).map { sample in
			let angle = Double(sample) * step
			let alongPath = Double(sample) / Double(Self.samplesPerFilament - 1) * drawn
			let radial = sphere.radius + kinkAmplitude * kinkOffset(
				alongPath: alongPath,
				kinks: kinks,
				filament: index,
				generation: generation
			)
			let point = radialUnit.scaled(radial * cos(angle))
				.adding(tangent.scaled(radial * sin(angle)))
			let scale = focal / (focal - point.z)
			return CGPoint(
				x: sphere.center.x + point.x * scale - zoneFrame.minX,
				y: sphere.center.y + point.y * scale - zoneFrame.minY
			)
		}
	}

	private func sphereGeometry(screenSize: CGSize) -> (center: CGPoint, radius: Double) {
		let center = CGPoint(
			x: (0.4 + 0.2 * sphereUnit(slot: .sphereCenterX)) * screenSize.width,
			y: (0.35 + 0.2 * sphereUnit(slot: .sphereCenterY)) * screenSize.height
		)
		let radius = (1.9 + 0.7 * sphereUnit(slot: .sphereRadius)) * max(screenSize.width, screenSize.height)
		return (center: center, radius: radius)
	}

	/// Lateral offset of a lightning-style bolt: seeded kink points joined by
	/// straight runs, so the path breaks direction sharply instead of undulating.
	private func kinkOffset(alongPath: Double, kinks: Int, filament: Int, generation: Int) -> Double {
		let scaled = alongPath * Double(kinks)
		let segment = min(Int(scaled), kinks - 1)
		let within = scaled - Double(segment)
		let from = kinkHeight(segment, filament: filament, generation: generation)
		let to = kinkHeight(segment + 1, filament: filament, generation: generation)
		return from + (to - from) * within
	}

	/// The bolt leaves its anchor exactly on the ring, so its start never jitters
	/// away from the point the lane placed it at.
	private func kinkHeight(_ index: Int, filament: Int, generation: Int) -> Double {
		index == 0 ? 0 : 2 * unit(filament: filament, generation: generation, slot: .kink(index)) - 1
	}

	private func gap(filament: Int, generation: Int) -> Double {
		0.12 + 0.5 * unit(filament: filament, generation: generation, slot: .gap)
	}

	private func veilOpacity(filament: Int, generation: Int, phase: Double, period: Double) -> Double {
		let breath = 0.88 + 0.12 * sin(
			2 * .pi * phase / Self.breathPeriodSeconds
				+ 2 * .pi * unit(filament: filament, generation: generation, slot: .breathPhase)
		)
		return breath * tailFade(cyclePhase: phase, period: period) * zone.opacityScale
	}

	private func tailFade(cyclePhase: Double, period: Double) -> Double {
		if cyclePhase < period - Self.fadeOutSeconds {
			return 1
		} else {
			return smoothstep((period - cyclePhase) / Self.fadeOutSeconds)
		}
	}

	private func cyclePeriod(filament: Int) -> Double {
		1.3 + 0.8 * unit(filament: filament, generation: 0, slot: .cyclePeriod)
	}

	private enum HashSlot {
		case kink(Int)
		case kinkCount
		case amplitudeJitter
		case gap
		case breathPhase
		case cyclePeriod
		case driftDirection
		case tangentTilt
		case span
		case anchorX
		case anchorY
		case sphereCenterX
		case sphereCenterY
		case sphereRadius

		var rawSlot: UInt64 {
			switch self {
			case .kink(let index): return 30 + UInt64(index)
			case .kinkCount: return 4
			case .amplitudeJitter: return 5
			case .gap: return 6
			case .breathPhase: return 7
			case .cyclePeriod: return 8
			case .driftDirection: return 9
			case .tangentTilt: return 10
			case .span: return 12
			case .anchorX: return 13
			case .anchorY: return 14
			case .sphereCenterX: return 16
			case .sphereCenterY: return 17
			case .sphereRadius: return 18
			}
		}
	}

	private func sphereUnit(slot: HashSlot) -> Double {
		var z = seed
		z ^= UInt64(Self.sphereScopeFilament) &* 0xBF58_476D_1CE4_E5B9
		z ^= slot.rawSlot
		return splitMix64Unit(z)
	}

	private func unit(filament: Int, generation: Int, slot: HashSlot) -> Double {
		var z = seed
		z ^= zone.salt &* 0x9E37_79B9_7F4A_7C15
		z ^= UInt64(filament) &* 0xBF58_476D_1CE4_E5B9
		z ^= UInt64(generation) &* 0x94D0_49BB_1331_11EB
		z ^= slot.rawSlot
		return splitMix64Unit(z)
	}
}
