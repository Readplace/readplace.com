import XCTest
@testable import Readplace

final class LaunchIntroTests: XCTestCase {
	func testFirstLaunchWithoutReduceMotionStartsPlaying() {
		XCTAssertEqual(LaunchIntro.initialPhase(isFirstLaunch: true, reduceMotion: false), .playing)
	}

	func testAReturningLaunchStartsIdle() {
		XCTAssertEqual(LaunchIntro.initialPhase(isFirstLaunch: false, reduceMotion: false), .idle)
	}

	func testReduceMotionStartsIdleOnAFirstLaunch() {
		XCTAssertEqual(LaunchIntro.initialPhase(isFirstLaunch: true, reduceMotion: true), .idle)
	}

	func testThePlayingOverlayShowsTheVideoAtFullOpacityOnADarkBackdrop() {
		XCTAssertEqual(
			LaunchIntro.overlay(for: .playing),
			LaunchIntroOverlay(showsVideo: true, opacity: 1, usesDarkBackdrop: true)
		)
	}

	func testTheFadingOverlayDropsTheDarkBackdropSoTheWhiteEndingCannotDim() {
		XCTAssertEqual(
			LaunchIntro.overlay(for: .fading),
			LaunchIntroOverlay(showsVideo: true, opacity: 0, usesDarkBackdrop: false)
		)
	}

	func testTheIdleOverlayRendersNothing() {
		XCTAssertEqual(
			LaunchIntro.overlay(for: .idle),
			LaunchIntroOverlay(showsVideo: false, opacity: 0, usesDarkBackdrop: false)
		)
	}

	func testTheFinishedOverlayRendersNothing() {
		XCTAssertEqual(
			LaunchIntro.overlay(for: .finished),
			LaunchIntroOverlay(showsVideo: false, opacity: 0, usesDarkBackdrop: false)
		)
	}

	func testPlayingToEndMovesToFading() {
		XCTAssertEqual(LaunchIntro.next(after: .playing, end: .playedToEnd), .fading)
	}

	func testAFailedAssetMovesToFading() {
		XCTAssertEqual(LaunchIntro.next(after: .playing, end: .assetFailed), .fading)
	}

	func testATimeoutMovesToFading() {
		XCTAssertEqual(LaunchIntro.next(after: .playing, end: .timedOut), .fading)
	}

	func testASkipMovesStraightToFinished() {
		XCTAssertEqual(LaunchIntro.next(after: .playing, end: .skipped), .finished)
	}

	func testATransitionFromANonPlayingPhaseIsIgnored() {
		XCTAssertEqual(LaunchIntro.next(after: .fading, end: .timedOut), .fading)
		XCTAssertEqual(LaunchIntro.next(after: .idle, end: .skipped), .idle)
	}

	func testMusicPlaysWhileLoggedOutAndForeground() {
		XCTAssertTrue(LaunchIntro.playsMusic(isLoggedIn: false, isForeground: true))
	}

	func testMusicStopsOnceLoggedIn() {
		XCTAssertFalse(LaunchIntro.playsMusic(isLoggedIn: true, isForeground: true))
	}

	func testMusicStopsInTheBackground() {
		XCTAssertFalse(LaunchIntro.playsMusic(isLoggedIn: false, isForeground: false))
	}
}
