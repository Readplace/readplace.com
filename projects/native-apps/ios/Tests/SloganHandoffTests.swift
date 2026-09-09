import CoreGraphics
import XCTest
@testable import Readplace

final class SloganHandoffTests: XCTestCase {
	private let sky = CGRect(x: 24, y: 60, width: 342, height: 240)
	private let subtitle = CGPoint(x: 195, y: 430)
	private let launch = CGPoint(x: 120, y: 150)
	private let handoff = SloganHandoff(
		outgoing: "Read what matters",
		incoming: "Paste a link. Read it clean.",
		startedAt: 10,
		ordinal: 0,
		seed: 42
	)

	private func comet(_ sinceStart: Double) -> SloganComet {
		handoff.comet(at: 10 + sinceStart, subtitleCenter: subtitle, sky: sky, launch: launch)
	}

	private func poses(_ sinceStart: Double) -> TextPoses {
		handoff.poses(at: 10 + sinceStart)
	}

	private func distance(_ a: CGPoint, _ b: CGPoint) -> Double {
		hypot(a.x - b.x, a.y - b.y)
	}

	func testBeforeTheHandoffTheOutgoingSloganStandsAlone() {
		XCTAssertEqual(poses(-1), TextPoses(outgoing: .shown, incoming: .hidden))
		XCTAssertEqual(comet(-1), .idle)
	}

	func testTheOutgoingSloganCondensesIntoAGrowingSpark() throws {
		let condensing = poses(0.15).outgoing
		XCTAssertEqual(condensing.opacity, 0.5, accuracy: 1e-9)
		XCTAssertEqual(condensing.scale, 0.725, accuracy: 1e-9)
		XCTAssertEqual(condensing.blur, 3, accuracy: 1e-9)
		XCTAssertEqual(poses(0.3).outgoing, .hidden)

		let early = try XCTUnwrap(comet(0.05).head)
		let late = try XCTUnwrap(comet(0.19).head)
		XCTAssertEqual(early.center, subtitle)
		XCTAssertEqual(late.center, subtitle)
		XCTAssertGreaterThan(early.opacity, 0)
		XCTAssertGreaterThan(late.coreRadius, early.coreRadius, "the spark swells as the words condense into it")
		XCTAssertEqual(comet(0.1).strokes, [], "a spark that has not flown yet trails nothing")
	}

	func testTheSparkFliesUpToItsLandingAndItsTailDrainsIntoTheStrike() throws {
		let landing = handoff.landing(sky: sky)
		let leaving = try XCTUnwrap(comet(0.25).head)
		let midway = try XCTUnwrap(comet(0.6).head)
		let landed = try XCTUnwrap(comet(0.9).head)

		XCTAssertLessThan(distance(leaving.center, subtitle), distance(leaving.center, landing))
		XCTAssertLessThan(distance(midway.center, landing), distance(leaving.center, landing), "the spark closes on its landing")
		XCTAssertEqual(landed.center.x, landing.x, accuracy: 1e-9)
		XCTAssertEqual(landed.center.y, landing.y, accuracy: 1e-9)
		XCTAssertEqual(Set(comet(0.6).strokes.map(\.tone)), [.star], "a comet burns at full strength, not in the lanes' veil")
		XCTAssertEqual(comet(0.6).strokes.count, 16)

		let draining = comet(1.0)
		XCTAssertEqual(draining.strokes.count, 16, "the tail is still catching up with the landed head")
		XCTAssertLessThan(try XCTUnwrap(draining.head).opacity, landed.opacity, "the head gives way to the bolt it became")
		XCTAssertEqual(comet(1.15), .idle, "once drained, the sky's bolt is the only trace")
		XCTAssertEqual(comet(1.3), .idle)
	}

	func testTheFlightBowsAwayFromTheStraightLine() throws {
		let landing = handoff.landing(sky: sky)
		let midway = try XCTUnwrap(comet(0.55).head).center

		let chordX = landing.x - subtitle.x
		let chordY = landing.y - subtitle.y
		let offChord = abs((midway.x - subtitle.x) * chordY - (midway.y - subtitle.y) * chordX) / hypot(chordX, chordY)
		XCTAssertGreaterThan(offChord, 20, "a straight shot through the wordmark would read as a bullet, not a star")
	}

	func testTheVisitIsBornWhereAndWhenTheSparkLands() {
		let visit = handoff.visit(sky: sky)

		XCTAssertEqual(visit, StarVisit(anchor: handoff.landing(sky: sky), bornAt: 10.9, hue: handoff.hue, ordinal: 0))
		XCTAssertGreaterThanOrEqual(visit.anchor.x, sky.minX + 0.18 * sky.width)
		XCTAssertLessThanOrEqual(visit.anchor.x, sky.minX + 0.82 * sky.width)
		XCTAssertGreaterThanOrEqual(visit.anchor.y, sky.minY + 0.15 * sky.height)
		XCTAssertLessThanOrEqual(visit.anchor.y, sky.minY + 0.75 * sky.height)
	}

	func testAStarLeavesTheStruckBoltAndBloomsIntoTheIncomingSlogan() throws {
		let leaving = try XCTUnwrap(comet(1.4).head)
		XCTAssertLessThan(distance(leaving.center, launch), distance(leaving.center, subtitle))
		XCTAssertEqual(comet(1.4).strokes.count, 16)

		let arrived = try XCTUnwrap(comet(2.05).head)
		XCTAssertEqual(arrived.center, subtitle)
		XCTAssertEqual(poses(2.05).incoming, .hidden)
		XCTAssertEqual(comet(2.05).strokes.count, 16, "the tail drains into the words as they form")

		let blooming = try XCTUnwrap(comet(2.3).head)
		XCTAssertEqual(blooming.center, subtitle)
		XCTAssertGreaterThan(blooming.glowRadius, arrived.glowRadius, "the light spreads out behind the words")
		XCTAssertLessThan(blooming.opacity, arrived.opacity)
		XCTAssertGreaterThan(poses(2.3).incoming.opacity, 0)
		XCTAssertLessThan(poses(2.3).incoming.opacity, 1)
		XCTAssertEqual(comet(2.3).strokes, [])

		XCTAssertEqual(poses(2.55), TextPoses(outgoing: .hidden, incoming: .shown))
		XCTAssertEqual(comet(2.55), .idle)
		XCTAssertEqual(poses(60), TextPoses(outgoing: .hidden, incoming: .shown))
	}

	func testTheSameMomentAlwaysDrawsTheSameComet() {
		XCTAssertEqual(comet(0.6), comet(0.6))
		XCTAssertEqual(comet(1.6), comet(1.6))
	}

	func testEveryHandoffLandsSomewhereElseInItsOwnHue() {
		let handoffs = (0..<40).map {
			SloganHandoff(outgoing: "a", incoming: "b", startedAt: 0, ordinal: $0, seed: 42)
		}
		let landings = handoffs.map { $0.landing(sky: sky) }
		let reseeded = SloganHandoff(outgoing: "a", incoming: "b", startedAt: 0, ordinal: 0, seed: 43)

		XCTAssertGreaterThan(distance(landings[0], landings[1]), 5)
		XCTAssertGreaterThan(distance(landings[0], reseeded.landing(sky: sky)), 5)
		XCTAssertGreaterThan(Set(handoffs.map(\.hue)).count, 1, "the sky is not one colour")
	}

	func testTheCometPathRunsBetweenItsEndsAndBowsByItsChord() {
		let straight = CometPath(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 0), bow: 0)
		let bowed = CometPath(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 0), bow: 0.25)

		XCTAssertEqual(straight.point(at: 0), CGPoint(x: 0, y: 0))
		XCTAssertEqual(straight.point(at: 1), CGPoint(x: 100, y: 0))
		XCTAssertEqual(straight.point(at: 0.5), CGPoint(x: 50, y: 0))
		XCTAssertEqual(bowed.point(at: 0.5), CGPoint(x: 50, y: 12.5), "the bow is a fraction of the chord's length")
		XCTAssertEqual(bowed.samples(from: 0, to: 1, count: 3), [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 12.5), CGPoint(x: 100, y: 0)])
	}
}
