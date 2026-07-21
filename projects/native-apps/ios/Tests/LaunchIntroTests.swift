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

	func testThePlayingOverlayShowsTheVideoAtFullOpacity() {
		XCTAssertEqual(LaunchIntro.overlay(for: .playing), LaunchIntroOverlay(showsVideo: true, opacity: 1))
	}

	func testTheFadingOverlayKeepsTheVideoMountedAtZeroOpacity() {
		XCTAssertEqual(LaunchIntro.overlay(for: .fading), LaunchIntroOverlay(showsVideo: true, opacity: 0))
	}

	func testTheIdleOverlayRendersNothing() {
		XCTAssertEqual(LaunchIntro.overlay(for: .idle), LaunchIntroOverlay(showsVideo: false, opacity: 0))
	}

	func testTheFinishedOverlayRendersNothing() {
		XCTAssertEqual(LaunchIntro.overlay(for: .finished), LaunchIntroOverlay(showsVideo: false, opacity: 0))
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

	func testMusicPlaysWhilePlayingAndForegroundAndLoggedOut() {
		XCTAssertTrue(LaunchIntro.playsMusic(phase: .playing, isLoggedIn: false, isForeground: true))
	}

	func testMusicKeepsPlayingOnTheLoginScreenAfterTheVideoFinishes() {
		XCTAssertTrue(LaunchIntro.playsMusic(phase: .finished, isLoggedIn: false, isForeground: true))
	}

	func testMusicStopsOnceLoggedIn() {
		XCTAssertFalse(LaunchIntro.playsMusic(phase: .playing, isLoggedIn: true, isForeground: true))
	}

	func testMusicStopsInTheBackground() {
		XCTAssertFalse(LaunchIntro.playsMusic(phase: .playing, isLoggedIn: false, isForeground: false))
	}

	func testMusicNeverPlaysWithoutTheIntro() {
		XCTAssertFalse(LaunchIntro.playsMusic(phase: .idle, isLoggedIn: false, isForeground: true))
	}
}
