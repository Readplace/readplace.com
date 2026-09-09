import SwiftUI
import UIKit
import XCTest
@testable import Readplace

@MainActor
final class CosmicWavesViewTests: XCTestCase {
	@MainActor
	private final class ClockBox {
		var clock = WaveClock(accumulated: 0, resumedAt: Date())

		var binding: Binding<WaveClock> {
			Binding(get: { self.clock }, set: { self.clock = $0 })
		}
	}

	private func makeLayer(
		zone: CosmicZone,
		reduceMotion: Bool,
		paused: Bool,
		clock: Binding<WaveClock>,
		visits: [StarVisit] = []
	) -> CosmicWavesLayer {
		CosmicWavesLayer(
			zone: zone,
			seed: 42,
			zoneFrame: CGRect(x: 0, y: 100, width: 390, height: 330),
			screenSize: CGSize(width: 390, height: 844),
			reduceMotion: reduceMotion,
			paused: paused,
			clock: clock,
			visits: visits
		)
	}

	func testTheAnimatedLayerMountsALiveViewHierarchy() {
		let box = ClockBox()

		XCTAssertGreaterThan(
			mountedViewCount(makeLayer(zone: .aboveBrand, reduceMotion: false, paused: false, clock: box.binding)),
			1
		)
	}

	func testTheLayerHostingAVisitMountsALiveViewHierarchy() {
		let box = ClockBox()
		let visit = StarVisit(anchor: CGPoint(x: 120, y: 200), bornAt: 0, hue: .cyan, ordinal: 0)

		XCTAssertGreaterThan(
			mountedViewCount(
				makeLayer(zone: .aboveBrand, reduceMotion: false, paused: false, clock: box.binding, visits: [visit])
			),
			1
		)
	}

	func testThePausedLayerMountsALiveViewHierarchy() {
		let box = ClockBox()

		XCTAssertGreaterThan(
			mountedViewCount(makeLayer(zone: .belowActions, reduceMotion: false, paused: true, clock: box.binding)),
			1
		)
	}

	func testTheReduceMotionLayerMountsAStaticHierarchy() {
		let box = ClockBox()

		XCTAssertGreaterThan(
			mountedViewCount(makeLayer(zone: .aboveBrand, reduceMotion: true, paused: false, clock: box.binding)),
			1
		)
	}

	func testTheEnvironmentWrapperMountsTheLayer() {
		let box = ClockBox()
		let view = CosmicWavesView(zone: .belowActions, seed: 42, clock: box.binding, visits: [])

		XCTAssertGreaterThan(mountedViewCount(view), 1)
	}

	func testPausingStopsTheSharedClockAndResumingRestartsIt() {
		let box = ClockBox()
		let window = UIWindow(frame: UIScreen.main.bounds)
		let host = UIHostingController(rootView: makeLayer(zone: .aboveBrand, reduceMotion: false, paused: false, clock: box.binding))
		window.rootViewController = host
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))

		host.rootView = makeLayer(zone: .aboveBrand, reduceMotion: false, paused: true, clock: box.binding)
		window.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))
		let later = Date(timeIntervalSinceNow: 100)
		XCTAssertEqual(
			box.clock.elapsed(at: later),
			box.clock.elapsed(at: later.addingTimeInterval(100)),
			accuracy: 1e-9,
			"a paused scene freezes the storm clock every zone reads"
		)

		host.rootView = makeLayer(zone: .aboveBrand, reduceMotion: false, paused: false, clock: box.binding)
		window.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))
		XCTAssertGreaterThan(
			box.clock.elapsed(at: later.addingTimeInterval(100)),
			box.clock.elapsed(at: later),
			"an active scene lets the storm clock run again"
		)
		XCTAssertGreaterThan(viewCount(in: window), 1)
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
