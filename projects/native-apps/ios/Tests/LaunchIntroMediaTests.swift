import AVFoundation
import Combine
import SwiftUI
import UIKit
import XCTest
@testable import Readplace

@MainActor
final class LaunchIntroMediaTests: XCTestCase {
	private func silentMusic() -> IntroMusic {
		IntroMusic(start: {}, stop: {}, restart: {}, seek: { _ in }, setMuted: { _ in })
	}

	private func freshSeen() -> LaunchIntroSeen {
		LaunchIntroSeen(defaults: TestSupport.ephemeralDefaults())
	}

	private func consumedSeen() -> LaunchIntroSeen {
		let defaults = TestSupport.ephemeralDefaults()
		_ = LaunchIntroSeen(defaults: defaults).claim()
		return LaunchIntroSeen(defaults: defaults)
	}

	private func makeModel(seen: LaunchIntroSeen) -> LaunchIntroModel {
		LaunchIntroModel(
			seen: seen,
			music: silentMusic(),
			mutePreference: IntroMutePreference(defaults: TestSupport.ephemeralDefaults()),
			reduceMotion: false
		)
	}

	private func mount(_ view: some View) -> UIWindow {
		let window = UIWindow(frame: UIScreen.main.bounds)
		window.rootViewController = UIHostingController(rootView: view)
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		return window
	}

	func testTheSystemMusicStartsStopsRestartsSeeksAndMutesWithoutCrashing() {
		let music = IntroMusic.system

		music.stop()
		music.setMuted(true)
		music.start()
		music.start()
		music.setMuted(false)
		music.restart()
		music.seek(LaunchIntro.videoDuration)
		music.stop()
		music.stop()
	}

	func testTheVideoContainerBacksItselfWithAPlayerLayer() {
		XCTAssertTrue(LaunchIntroVideoContainerView.layerClass == AVPlayerLayer.self)
		XCTAssertNotNil(LaunchIntroVideoContainerView().playerLayer)
	}

	func testTheCompositionRootBuildsAnIdleModelOnAReturningLaunch() {
		_ = makeLaunchIntroModel(reduceMotion: true)
		let model = makeLaunchIntroModel(reduceMotion: true)

		XCTAssertEqual(model.phase, .idle, "reduce motion never enters the intro")
	}

	func testTheOverlayRendersNothingForAnIdleModel() {
		let model = makeModel(seen: consumedSeen())

		let window = mount(LaunchIntroOverlayView(model: model))

		XCTAssertEqual(model.overlay.showsVideo, false)
		XCTAssertGreaterThanOrEqual(viewCount(in: window), 1)
	}

	func testPlayingToEndDrivesTheModelToFading() {
		let model = makeModel(seen: freshSeen())
		_ = mount(LaunchIntroOverlayView(model: model))

		expectPhase(.fading, on: model) {
			NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: nil)
		}
	}

	func testAFailedItemDrivesTheModelToFading() {
		let model = makeModel(seen: freshSeen())
		_ = mount(LaunchIntroOverlayView(model: model))

		expectPhase(.fading, on: model) {
			NotificationCenter.default.post(name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
		}
	}

	func testTheFadeCompletesToFinished() {
		let model = makeModel(seen: freshSeen())
		_ = mount(LaunchIntroOverlayView(model: model))

		expectPhase(.fading, on: model) {
			NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: nil)
		}
		expectPhase(.finished, on: model) {}
	}

	private func expectPhase(
		_ phase: LaunchIntroPhase,
		on model: LaunchIntroModel,
		timeout: TimeInterval = 2,
		when trigger: () -> Void,
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		if model.phase == phase {
			trigger()
			return
		}
		let reached = expectation(description: "phase \(phase)")
		let cancellable = model.$phase.sink { if $0 == phase { reached.fulfill() } }
		trigger()
		wait(for: [reached], timeout: timeout)
		cancellable.cancel()
	}

	private func viewCount(in view: UIView) -> Int {
		view.subviews.reduce(1) { $0 + viewCount(in: $1) }
	}
}
