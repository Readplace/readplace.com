import SwiftUI
import UIKit
import XCTest
@testable import Readplace

@MainActor
final class SloganCometsViewTests: XCTestCase {
	private let sky = CGRect(x: 24, y: 60, width: 342, height: 240)
	private let subtitle = CGRect(x: 60, y: 420, width: 270, height: 20)
	private let screenSize = CGSize(width: 390, height: 844)

	private var landmarks: [LoginLandmark: CGRect] { [.sky: sky, .subtitle: subtitle] }

	private func makeHandoff(startedAt: TimeInterval = 0, ordinal: Int = 0) -> SloganHandoff {
		SloganHandoff(outgoing: "A", incoming: "B", startedAt: startedAt, ordinal: ordinal, seed: 42)
	}

	private func comet(
		_ elapsed: TimeInterval,
		handoff: SloganHandoff?,
		landmarks: [LoginLandmark: CGRect]
	) -> SloganComet {
		loginComet(handoff: handoff, landmarks: landmarks, seed: 42, screenSize: screenSize, elapsed: elapsed)
	}

	func testAScreenWithNothingToHandOverDrawsNoComet() {
		XCTAssertEqual(comet(0.5, handoff: nil, landmarks: landmarks), .idle)
	}

	func testACometWaitsUntilTheScreenHasReportedBothLandmarks() {
		let handoff = makeHandoff()

		XCTAssertEqual(comet(0.5, handoff: handoff, landmarks: [:]), .idle)
		XCTAssertEqual(comet(0.5, handoff: handoff, landmarks: [.sky: sky]), .idle)
		XCTAssertEqual(comet(0.5, handoff: handoff, landmarks: [.subtitle: subtitle]), .idle)
		XCTAssertNotEqual(comet(0.5, handoff: handoff, landmarks: landmarks), .idle)
	}

	func testTheSparkIsBornOnTheSubtitleAndLandsOnTheStrikePoint() throws {
		let handoff = makeHandoff()

		let spark = try XCTUnwrap(comet(0.1, handoff: handoff, landmarks: landmarks).head)
		let landed = try XCTUnwrap(comet(SloganHandoff.landingAt, handoff: handoff, landmarks: landmarks).head)

		XCTAssertEqual(spark.center, CGPoint(x: subtitle.midX, y: subtitle.midY))
		XCTAssertEqual(landed.center.x, handoff.landing(sky: sky).x, accuracy: 1e-9)
		XCTAssertEqual(landed.center.y, handoff.landing(sky: sky).y, accuracy: 1e-9)
	}

	func testTheDescendingStarAlwaysLeavesFromInsideTheSkyPanel() throws {
		for ordinal in 0..<25 {
			let handoff = makeHandoff(ordinal: ordinal)

			let leaving = try XCTUnwrap(comet(SloganHandoff.descentStart + 0.02, handoff: handoff, landmarks: landmarks).head)

			XCTAssertTrue(
				sky.insetBy(dx: -0.5, dy: -0.5).contains(leaving.center),
				"handoff \(ordinal) starts its star at \(leaving.center), outside the sky panel at \(sky)"
			)
		}
	}

	func testTheCometBloomsBackOntoTheSubtitle() throws {
		let handoff = makeHandoff()

		let arrived = try XCTUnwrap(comet(SloganHandoff.arrivalAt, handoff: handoff, landmarks: landmarks).head)
		let blooming = try XCTUnwrap(comet(SloganHandoff.arrivalAt + 0.25, handoff: handoff, landmarks: landmarks).head)

		XCTAssertEqual(arrived.center, CGPoint(x: subtitle.midX, y: subtitle.midY))
		XCTAssertEqual(blooming.center, arrived.center)
		XCTAssertGreaterThan(blooming.glowRadius, arrived.glowRadius)
	}

	func testTheSkyHostsAVisitOnlyOnceThereIsAHandoffAndAPanelToStrike() {
		let handoff = makeHandoff()

		XCTAssertEqual(skyVisits(handoff: nil, landmarks: landmarks), [])
		XCTAssertEqual(skyVisits(handoff: handoff, landmarks: [.subtitle: subtitle]), [])
		XCTAssertEqual(skyVisits(handoff: handoff, landmarks: landmarks), [handoff.visit(sky: sky)])
	}

	private func makeView(handoff: SloganHandoff?, reduceMotion: Bool) -> SloganCometsView {
		SloganCometsView(
			handoff: handoff,
			clock: WaveClock(accumulated: 0.5, resumedAt: nil),
			seed: 42,
			landmarks: landmarks,
			screenSize: screenSize,
			paused: false,
			reduceMotion: reduceMotion
		)
	}

	func testACometInFlightMountsALiveCanvas() {
		XCTAssertGreaterThan(mountedViewCount(makeView(handoff: makeHandoff(), reduceMotion: false)), 1)
	}

	func testAnIdleScreenMountsALiveCanvas() {
		XCTAssertGreaterThan(mountedViewCount(makeView(handoff: nil, reduceMotion: false)), 1)
	}

	func testAReduceMotionScreenMountsNoCanvasAtAll() {
		XCTAssertGreaterThan(mountedViewCount(makeView(handoff: makeHandoff(), reduceMotion: true)), 1)
	}

	private func mountedViewCount(_ view: some View) -> Int {
		let window = UIWindow(frame: UIScreen.main.bounds)
		window.rootViewController = UIHostingController(rootView: view)
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.2))
		return viewCount(in: window)
	}

	private func viewCount(in view: UIView) -> Int {
		view.subviews.reduce(1) { $0 + viewCount(in: $1) }
	}
}
