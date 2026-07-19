import CoreGraphics
import UIKit
import XCTest
@testable import Readplace

final class CosmicWaveFieldTests: XCTestCase {
	private let screenSize = CGSize(width: 390, height: 844)
	private let topFrame = CGRect(x: 0, y: 100, width: 390, height: 330)
	private let bottomFrame = CGRect(x: 0, y: 600, width: 390, height: 150)
	private let field = CosmicWaveField(seed: 42, zone: .aboveBrand)

	private func strokes(_ elapsed: TimeInterval) -> [FilamentStroke] {
		field.strokes(zoneFrame: topFrame, screenSize: screenSize, elapsed: elapsed)
	}

	private func cores(_ elapsed: TimeInterval, hue: CosmicHue) -> [FilamentStroke] {
		strokes(elapsed).enumerated().filter { $0.offset % 2 == 1 && $0.element.hue == hue }.map(\.element)
	}

	private func arcLength(_ elapsed: TimeInterval, hue: CosmicHue) -> Double {
		cores(elapsed, hue: hue).reduce(0) { total, stroke in
			total + zip(stroke.points, stroke.points.dropFirst()).reduce(0) {
				$0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y)
			}
		}
	}

	private func peakOpacity(_ elapsed: TimeInterval, hue: CosmicHue) -> Double {
		cores(elapsed, hue: hue).map(\.opacity).max() ?? 0
	}

	private func birth(of hue: CosmicHue, after start: TimeInterval) -> TimeInterval {
		var elapsed = start
		while arcLength(elapsed, hue: hue) == 0, elapsed < start + 14 {
			elapsed += 0.01
		}
		return elapsed
	}

	/// A moment when this hue's bolt has finished drawing itself in — bolts live
	/// for under two seconds, so no fixed timestamp is reliably mid-life.
	private func matured(hue: CosmicHue, after start: TimeInterval) -> TimeInterval? {
		var elapsed = start
		while elapsed < start + 20 {
			let trail = cores(elapsed, hue: hue)
			let points = trail.flatMap(\.points)
			if trail.count == 8, let first = points.first, let last = points.last,
				hypot(last.x - first.x, last.y - first.y) > 40 {
				return elapsed
			}
			elapsed += 0.02
		}
		return nil
	}

	func testSameSeedAndTimeProduceIdenticalStrokes() {
		XCTAssertEqual(strokes(4), strokes(4))
	}

	func testDifferentSeedsProduceDifferentGeometry() {
		let other = CosmicWaveField(seed: 43, zone: .aboveBrand)

		XCTAssertNotEqual(
			strokes(4).first?.points,
			other.strokes(zoneFrame: topFrame, screenSize: screenSize, elapsed: 4).first?.points
		)
	}

	func testDegenerateGeometryProducesNoStrokes() {
		XCTAssertEqual(field.strokes(zoneFrame: .zero, screenSize: screenSize, elapsed: 6), [])
		XCTAssertEqual(field.strokes(zoneFrame: topFrame, screenSize: .zero, elapsed: 6), [])
		XCTAssertEqual(field.staticStrokes(zoneFrame: .zero, screenSize: screenSize), [])
		XCTAssertEqual(field.staticStrokes(zoneFrame: topFrame, screenSize: .zero), [])
	}

	func testNothingIsVisibleAtLaunch() {
		XCTAssertEqual(strokes(0), [])
	}

	func testEverySegmentDrawsAGlowUnderItsCore() throws {
		let visible = strokes(try XCTUnwrap(matured(hue: .amberHighlight, after: 0)))
		XCTAssertFalse(visible.isEmpty)
		XCTAssertEqual(visible.count % 2, 0)
		for pair in stride(from: 0, to: visible.count, by: 2) {
			let glow = visible[pair]
			let core = visible[pair + 1]
			XCTAssertEqual(glow.points, core.points)
			XCTAssertEqual(glow.hue, core.hue)
			XCTAssertEqual(glow.opacity, 0.5 * core.opacity, accuracy: 1e-12)
			XCTAssertGreaterThan(glow.lineWidth, core.lineWidth)
			XCTAssertEqual(glow.blurRadius, 6.0)
			XCTAssertEqual(core.blurRadius, 0, "the crisp core draws straight, without paying for an offscreen blur layer")
		}
	}

	func testTheTailFadesAndThinsAwayFromTheHead() throws {
		let moment = try XCTUnwrap(matured(hue: .amberHighlight, after: 0))
		let trail = cores(moment, hue: .amberHighlight)
		XCTAssertEqual(trail.count, 8)

		let tail = trail[0]
		let head = trail[7]
		XCTAssertLessThan(tail.opacity, head.opacity * 0.2, "the tail must dissolve, not end in a blunt line")
		// Brightness alone carries the taper: a bolt whose width also collapsed to a
		// point would read as a tadpole rather than a strike.
		XCTAssertGreaterThan(tail.lineWidth, head.lineWidth * 0.6, "the bolt must keep an even width, not whip to a tip")
		for (nearer, further) in zip(trail, trail.dropFirst()) {
			XCTAssertLessThan(nearer.opacity, further.opacity, "brightness must rise steadily toward the head")
		}
	}

	func testTheBoltIsPinnedBetweenTwoFixedPointsForItsWholeLife() throws {
		let born = birth(of: .amberHighlight, after: 0)
		let drawing = cores(born + 0.06, hue: .amberHighlight)
		let drawn = cores(born + 0.36, hue: .amberHighlight)
		let dying = cores(born + 0.60, hue: .amberHighlight)

		let tails = try [drawing, drawn, dying].map { try XCTUnwrap($0.first?.points.first) }
		XCTAssertEqual(hypot(tails[1].x - tails[0].x, tails[1].y - tails[0].y), 0, accuracy: 0.001, "the start never moves")
		XCTAssertEqual(hypot(tails[2].x - tails[0].x, tails[2].y - tails[0].y), 0, accuracy: 0.001, "the start never moves")

		let settledHead = try XCTUnwrap(drawn.last?.points.last)
		let dyingHead = try XCTUnwrap(dying.last?.points.last)
		XCTAssertEqual(
			hypot(dyingHead.x - settledHead.x, dyingHead.y - settledHead.y),
			0,
			accuracy: 0.001,
			"once drawn, the end stays where it landed instead of trailing onward"
		)
	}

	func testTheBoltBreaksDirectionInsteadOfUndulating() {
		var kinked = 0
		for lane in 0..<5 {
			guard let bolt = maturePolyline(lane: lane) else { continue }
			var turns: [Double] = []
			for index in 1..<(bolt.count - 1) {
				let inbound = CGPoint(x: bolt[index].x - bolt[index - 1].x, y: bolt[index].y - bolt[index - 1].y)
				let outbound = CGPoint(x: bolt[index + 1].x - bolt[index].x, y: bolt[index + 1].y - bolt[index].y)
				turns.append(inbound.x * outbound.y - inbound.y * outbound.x)
			}
			let reversals = zip(turns, turns.dropFirst()).filter { ($0 < 0) != ($1 < 0) }.count
			if reversals >= 2 { kinked += 1 }
		}

		XCTAssertGreaterThanOrEqual(kinked, 2, "bolts must zigzag, not run as one smooth curve")
	}

	func testTheArcGrowsFromNothingToItsFullLength() {
		let born = birth(of: .amberHighlight, after: 0)

		let justBorn = arcLength(born + 0.04, hue: .amberHighlight)
		let halfway = arcLength(born + 0.16, hue: .amberHighlight)
		let grown = arcLength(born + 0.5, hue: .amberHighlight)

		XCTAssertGreaterThan(justBorn, 0)
		XCTAssertGreaterThan(halfway, justBorn * 2, "the streak must draw itself out, not pop in at full length")
		XCTAssertGreaterThan(grown, halfway)
	}

	func testTheBoltFadesOutAtFullLengthInsteadOfRetracting() throws {
		let moment = try XCTUnwrap(matured(hue: .amberHighlight, after: 0))
		let grown = arcLength(moment, hue: .amberHighlight)
		let midLifeOpacity = peakOpacity(moment, hue: .amberHighlight)

		var elapsed = moment
		var lastVisible = elapsed
		while peakOpacity(elapsed, hue: .amberHighlight) > 0, elapsed < moment + 5 {
			lastVisible = elapsed
			elapsed += 0.02
		}
		let dyingLength = arcLength(lastVisible, hue: .amberHighlight)
		let dyingOpacity = peakOpacity(lastVisible, hue: .amberHighlight)

		XCTAssertGreaterThan(dyingLength, grown * 0.9, "the bolt keeps its full length while it fades")
		XCTAssertLessThan(dyingOpacity, midLifeOpacity * 0.35, "the bolt leaves by fading, not by shrinking")
	}

	func testEveryBoltIsLongEnoughToRead() throws {
		for lane in 0..<5 {
			let bolt = try XCTUnwrap(maturePolyline(lane: lane), "lane \(lane) must produce a bolt")
			let start = try XCTUnwrap(bolt.first)
			let end = try XCTUnwrap(bolt.last)

			XCTAssertGreaterThan(hypot(end.x - start.x, end.y - start.y), 40, "lane \(lane) draws a bolt, not a dot")
		}
	}

	func testTheSphereIsAnchoredToTheScreenNotToTheZone() {
		let higher = field.strokes(
			zoneFrame: CGRect(x: 0, y: 60, width: 390, height: 330),
			screenSize: screenSize,
			elapsed: 4
		)
		let lower = field.strokes(
			zoneFrame: CGRect(x: 0, y: 400, width: 390, height: 330),
			screenSize: screenSize,
			elapsed: 4
		)

		XCTAssertNotEqual(higher.first?.points, lower.first?.points, "moving the zone must slide it over one fixed sphere")
	}

	func testFilamentsNeverOverlapEachOther() {
		let below = CosmicWaveField(seed: 42, zone: .belowActions)
		for elapsed in stride(from: 0.5, through: 40.0, by: 0.1) {
			assertBandsStayApart(
				field.strokes(zoneFrame: topFrame, screenSize: screenSize, elapsed: elapsed),
				in: topFrame.size,
				at: elapsed
			)
			assertBandsStayApart(
				below.strokes(zoneFrame: bottomFrame, screenSize: screenSize, elapsed: elapsed),
				in: bottomFrame.size,
				at: elapsed
			)
		}
	}

	func testTheStaticCompositionAlsoKeepsItsFilamentsApart() {
		assertBandsStayApart(
			field.staticStrokes(zoneFrame: topFrame, screenSize: screenSize),
			in: topFrame.size,
			at: 0
		)
		assertBandsStayApart(
			CosmicWaveField(seed: 42, zone: .belowActions).staticStrokes(zoneFrame: bottomFrame, screenSize: screenSize),
			in: bottomFrame.size,
			at: 0
		)
	}

	func testTheProjectionKeepsEveryStreakInFrontOfTheEye() {
		for elapsed in stride(from: 0.5, through: 20.0, by: 0.25) {
			for stroke in strokes(elapsed) {
				XCTAssertGreaterThan(stroke.lineWidth, 0, "a point behind the eye would invert the stroke")
				XCTAssertLessThan(stroke.lineWidth, 40, "a point near the focal plane would blow the stroke up")
			}
		}
	}

	func testFilamentsRemainVisibleInsideTheZone() throws {
		let rect = CGRect(origin: .zero, size: topFrame.size)

		let inside = strokes(try XCTUnwrap(matured(hue: .amberHighlight, after: 0)))
			.flatMap(\.points)
			.filter { rect.contains($0) }

		XCTAssertGreaterThanOrEqual(inside.count, 20, "arcs must actually cross the visible zone")
	}

	func testCoreOpacityNeverExceedsTheCeiling() {
		for elapsed in stride(from: 0.0, through: 60.0, by: 0.25) {
			for stroke in strokes(elapsed) {
				XCTAssertLessThanOrEqual(stroke.opacity, 1.0)
				XCTAssertGreaterThan(stroke.opacity, 0)
			}
		}
	}

	func testTheStormKeepsSeveralStreaksInFlightAtOnce() {
		var busiest = 0
		var totalLanes = 0
		var samples = 0
		for elapsed in stride(from: 2.0, through: 30.0, by: 0.1) {
			let lanes = Set(strokes(elapsed).map(\.lane)).count
			busiest = max(busiest, lanes)
			totalLanes += lanes
			samples += 1
		}
		let average = Double(totalLanes) / Double(samples)

		XCTAssertGreaterThanOrEqual(busiest, 4, "a storm must light up most lanes at its peak")
		XCTAssertGreaterThan(average, 2.0, "on average several streaks are in flight together")
	}

	func testEveryStreakLivesAndDiesWithinAFewSeconds() {
		let born = birth(of: .amberHighlight, after: 0)
		var elapsed = born
		while peakOpacity(elapsed, hue: .amberHighlight) > 0, elapsed < born + 10 {
			elapsed += 0.02
		}

		XCTAssertLessThan(elapsed - born, 3.0, "a storm streak flashes past, it does not linger")
	}

	func testRespawnStrikesSomewhereElse() throws {
		let moment = try XCTUnwrap(matured(hue: .amberHighlight, after: 0))
		let first = try XCTUnwrap(centroid(at: moment, hue: .amberHighlight))
		let later = try XCTUnwrap(matured(hue: .amberHighlight, after: moment + 2.5))
		let second = try XCTUnwrap(centroid(at: later, hue: .amberHighlight))

		XCTAssertGreaterThan(hypot(first.x - second.x, first.y - second.y), 5, "the next strike lands somewhere else")
	}

	func testTheQuietZoneRunsAtEightyPercentOpacity() {
		let below = CosmicWaveField(seed: 42, zone: .belowActions)

		let quiet = below.staticStrokes(zoneFrame: bottomFrame, screenSize: screenSize)

		XCTAssertEqual(quiet.count, 48)
		XCTAssertEqual(Set(quiet.map(\.hue)), [.deepAmber, .violet, .cyan])
		XCTAssertLessThanOrEqual(quiet.map(\.opacity).max() ?? 0, 0.7 * 0.8 + 1e-9)
		let peak = quiet.enumerated().filter { $0.offset % 2 == 1 }.map(\.element.opacity).max() ?? 0
		XCTAssertLessThanOrEqual(peak, 0.7 * 0.8 + 1e-9)
	}

	func testStaticCompositionIsFullyPopulatedAndTimeless() {
		let still = field.staticStrokes(zoneFrame: topFrame, screenSize: screenSize)

		XCTAssertEqual(still.count, 80)
		XCTAssertEqual(still, field.staticStrokes(zoneFrame: topFrame, screenSize: screenSize))
		let peak = still.enumerated().filter { $0.offset % 2 == 1 }.map(\.element.opacity).max() ?? 0
		XCTAssertLessThanOrEqual(peak, 0.7 + 1e-9)
	}

	func testEdgeFadesKeepFilamentsAwayFromContent() {
		XCTAssertEqual(CosmicZone.aboveBrand.horizontalFade, EdgeFade(leadIn: 0.10, leadOut: 0.10))
		XCTAssertEqual(CosmicZone.aboveBrand.verticalFade, EdgeFade(leadIn: 0.06, leadOut: 0.10))
		XCTAssertEqual(CosmicZone.belowActions.horizontalFade, EdgeFade(leadIn: 0.10, leadOut: 0.10))
		XCTAssertEqual(CosmicZone.belowActions.verticalFade, EdgeFade(leadIn: 0.12, leadOut: 0.12))
	}

	func testHuesResolveToTheirCosmicTokens() {
		assertHue(.amberHighlight, light: "#C8923C", lightAlpha: 0.20, dark: "#D4A04A", darkAlpha: 0.28)
		assertHue(.deepAmber, light: "#C8702A", lightAlpha: 0.18, dark: "#D4833A", darkAlpha: 0.26)
		assertHue(.violet, light: "#6C429E", lightAlpha: 0.15, dark: "#A880D6", darkAlpha: 0.22)
		assertHue(.cyan, light: "#4A7FB5", lightAlpha: 0.14, dark: "#7AB2DE", darkAlpha: 0.20)
		assertHue(.magenta, light: "#B0447A", lightAlpha: 0.13, dark: "#DE82B2", darkAlpha: 0.18)
	}

	func testEveryHueBridgesToSwiftUIWithItsDynamicVariantsIntact() {
		for hue in CosmicHue.allCases {
			for style in [UIUserInterfaceStyle.light, .dark] {
				let bridged = resolve(UIColor(hue.color), style)
				let expected = resolve(hue.uiColor, style)
				XCTAssertEqual(bridged.hex, expected.hex, "\(hue)")
				XCTAssertEqual(bridged.alpha, expected.alpha, accuracy: 1e-9, "\(hue)")
			}
		}
	}

	func testTheClockAccumulatesOnlyWhileRunning() {
		let start = Date(timeIntervalSinceReferenceDate: 1000)
		let running = WaveClock(accumulated: 0, resumedAt: start)
		XCTAssertEqual(running.elapsed(at: start.addingTimeInterval(5)), 5, accuracy: 1e-12)

		let pausedClock = running.pausing(at: start.addingTimeInterval(8))
		XCTAssertEqual(pausedClock.elapsed(at: start.addingTimeInterval(60)), 8, accuracy: 1e-12)

		let resumed = pausedClock.resuming(at: start.addingTimeInterval(60))
		XCTAssertEqual(resumed.elapsed(at: start.addingTimeInterval(63)), 11, accuracy: 1e-12)
	}

	func testRedundantClockTransitionsAreIgnored() {
		let start = Date(timeIntervalSinceReferenceDate: 1000)
		let running = WaveClock(accumulated: 3, resumedAt: start)
		let pausedClock = WaveClock(accumulated: 3, resumedAt: nil)

		XCTAssertEqual(running.resuming(at: start.addingTimeInterval(9)), running)
		XCTAssertEqual(pausedClock.pausing(at: start.addingTimeInterval(9)), pausedClock)
	}

	func testAClockSetbackFreezesTheWavesInsteadOfBlankingThem() {
		let start = Date(timeIntervalSinceReferenceDate: 1000)
		let running = WaveClock(accumulated: 3, resumedAt: start)

		XCTAssertEqual(running.elapsed(at: start.addingTimeInterval(-30)), 3, accuracy: 1e-12)
		XCTAssertEqual(running.pausing(at: start.addingTimeInterval(-30)).accumulated, 3, accuracy: 1e-12)
	}

	private func assertBandsStayApart(
		_ visible: [FilamentStroke],
		in zoneSize: CGSize,
		at elapsed: TimeInterval,
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		let onScreen = CGRect(origin: .zero, size: zoneSize).insetBy(dx: -8, dy: -8)
		var spans: [Int: ClosedRange<Double>] = [:]
		for stroke in visible {
			// Only what the zone actually shows can visibly collide; a streak that
			// has flown past the zone edge is clipped away by the mask.
			for point in stroke.points where onScreen.contains(point) {
				let existing = spans[stroke.lane]
				let low = min(existing?.lowerBound ?? point.y, point.y)
				let high = max(existing?.upperBound ?? point.y, point.y)
				spans[stroke.lane] = low...high
			}
		}
		let ordered = spans.sorted { $0.value.lowerBound < $1.value.lowerBound }
		for (earlier, later) in zip(ordered, ordered.dropFirst()) {
			XCTAssertLessThan(
				earlier.value.upperBound,
				later.value.lowerBound,
				"lanes \(earlier.key) and \(later.key) overlap at t=\(elapsed)",
				file: file,
				line: line
			)
		}
	}

	/// The full polyline of a lane's bolt once it has finished drawing itself in.
	private func maturePolyline(lane: Int) -> [CGPoint]? {
		for step in 0..<400 {
			let elapsed = 0.5 + Double(step) * 0.05
			let drawn = strokes(elapsed).filter { $0.lane == lane }
			guard drawn.count == 16 else { continue }
			let points = drawn.enumerated().filter { $0.offset % 2 == 1 }.flatMap(\.element.points)
			guard let start = points.first, let end = points.last,
				hypot(end.x - start.x, end.y - start.y) > 40 else { continue }
			return points
		}
		return nil
	}

	private func centroid(at elapsed: TimeInterval, hue: CosmicHue) -> CGPoint? {
		let points = strokes(elapsed).filter { $0.hue == hue }.flatMap(\.points)
		guard !points.isEmpty else { return nil }
		let sum = points.reduce(CGPoint.zero) { CGPoint(x: $0.x + $1.x, y: $0.y + $1.y) }
		return CGPoint(x: sum.x / Double(points.count), y: sum.y / Double(points.count))
	}

	private func assertHue(
		_ hue: CosmicHue,
		light: String,
		lightAlpha: Double,
		dark: String,
		darkAlpha: Double,
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		let lightResolved = resolve(hue.uiColor, .light)
		let darkResolved = resolve(hue.uiColor, .dark)
		XCTAssertEqual(lightResolved.hex, light, "light", file: file, line: line)
		XCTAssertEqual(lightResolved.alpha, lightAlpha, accuracy: 1e-9, "light alpha", file: file, line: line)
		XCTAssertEqual(darkResolved.hex, dark, "dark", file: file, line: line)
		XCTAssertEqual(darkResolved.alpha, darkAlpha, accuracy: 1e-9, "dark alpha", file: file, line: line)
	}

	private func resolve(_ color: UIColor, _ style: UIUserInterfaceStyle) -> (hex: String, alpha: Double) {
		let resolved = color.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
		var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
		resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
		let hex = String(
			format: "#%02X%02X%02X",
			Int((red * 255).rounded()),
			Int((green * 255).rounded()),
			Int((blue * 255).rounded())
		)
		return (hex: hex, alpha: alpha)
	}
}
