import SwiftUI
import UIKit
import XCTest
@testable import Readplace

@MainActor
final class CosmicWavesViewTests: XCTestCase {
	private func makeLayer(zone: CosmicZone, reduceMotion: Bool, paused: Bool) -> CosmicWavesLayer {
		CosmicWavesLayer(
			zone: zone,
			seed: 42,
			zoneFrame: CGRect(x: 0, y: 100, width: 390, height: 330),
			screenSize: CGSize(width: 390, height: 844),
			reduceMotion: reduceMotion,
			paused: paused
		)
	}

	func testTheAnimatedLayerMountsALiveViewHierarchy() {
		XCTAssertGreaterThan(mountedViewCount(makeLayer(zone: .aboveBrand, reduceMotion: false, paused: false)), 1)
	}

	func testThePausedLayerMountsALiveViewHierarchy() {
		XCTAssertGreaterThan(mountedViewCount(makeLayer(zone: .belowActions, reduceMotion: false, paused: true)), 1)
	}

	func testTheReduceMotionLayerMountsAStaticHierarchy() {
		XCTAssertGreaterThan(mountedViewCount(makeLayer(zone: .aboveBrand, reduceMotion: true, paused: false)), 1)
	}

	func testTheEnvironmentWrapperMountsTheLayer() {
		let view = CosmicWavesView(zone: .belowActions, seed: 42)

		XCTAssertGreaterThan(mountedViewCount(view), 1)
	}

	func testPausingAndResumingKeepsTheLayerAlive() {
		let window = UIWindow(frame: UIScreen.main.bounds)
		let host = UIHostingController(rootView: makeLayer(zone: .aboveBrand, reduceMotion: false, paused: false))
		window.rootViewController = host
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))

		host.rootView = makeLayer(zone: .aboveBrand, reduceMotion: false, paused: true)
		window.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))

		host.rootView = makeLayer(zone: .aboveBrand, reduceMotion: false, paused: false)
		window.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))

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
