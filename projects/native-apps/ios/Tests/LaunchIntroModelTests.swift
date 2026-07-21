import XCTest
@testable import Readplace

@MainActor
final class LaunchIntroModelTests: XCTestCase {
	private final class MusicLog {
		var starts = 0
		var stops = 0
		var restarts = 0
		var seeks: [TimeInterval] = []
		var muted: Bool?
	}

	private func makeSpy(_ log: MusicLog) -> IntroMusic {
		IntroMusic(
			start: { log.starts += 1 },
			stop: { log.stops += 1 },
			restart: { log.restarts += 1 },
			seek: { log.seeks.append($0) },
			setMuted: { log.muted = $0 }
		)
	}

	private func freshSeen() -> LaunchIntroSeen {
		LaunchIntroSeen(defaults: TestSupport.ephemeralDefaults())
	}

	private func consumedSeen() -> LaunchIntroSeen {
		let defaults = TestSupport.ephemeralDefaults()
		_ = LaunchIntroSeen(defaults: defaults).claim()
		return LaunchIntroSeen(defaults: defaults)
	}

	private func mutePreference(muted: Bool = false) -> IntroMutePreference {
		let preference = IntroMutePreference(defaults: TestSupport.ephemeralDefaults())
		preference.setMuted(muted)
		return preference
	}

	private func makeModel(
		log: MusicLog,
		seen: LaunchIntroSeen,
		reduceMotion: Bool = false,
		mute: IntroMutePreference? = nil
	) -> LaunchIntroModel {
		LaunchIntroModel(
			seen: seen,
			music: makeSpy(log),
			mutePreference: mute ?? mutePreference(),
			reduceMotion: reduceMotion
		)
	}

	func testAFirstLaunchStartsTheMusicImmediately() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())

		XCTAssertEqual(model.phase, .playing)
		XCTAssertEqual(log.starts, 1)
	}

	func testAReturningLaunchNeverStartsTheMusic() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: consumedSeen())

		XCTAssertEqual(model.phase, .idle)
		XCTAssertEqual(log.starts, 0)
	}

	func testReduceMotionNeverStartsTheMusic() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen(), reduceMotion: true)

		XCTAssertEqual(model.phase, .idle)
		XCTAssertEqual(log.starts, 0)
	}

	func testTheInitialMuteStateReflectsTheSavedPreference() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen(), mute: mutePreference(muted: true))

		XCTAssertTrue(model.isMuted)
		XCTAssertEqual(log.muted, true, "the saved mute preference is applied to the player at launch")
	}

	func testEndingPlaybackMovesToFadingAndKeepsTheMusicRunning() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())

		model.end(.playedToEnd)

		XCTAssertEqual(model.phase, .fading)
		XCTAssertEqual(log.stops, 0, "the music outlives the video and stops on login, not on dismissal")
	}

	func testSkippingJumpsTheMusicToTheVideoEndAndKeepsItPlaying() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())

		model.end(.skipped)

		XCTAssertEqual(model.phase, .finished)
		XCTAssertEqual(log.stops, 0, "skipping does not stop the music; it stays in sync with the video's end")
		XCTAssertEqual(log.seeks, [LaunchIntro.videoDuration], "the music jumps to where it would be at the video's natural end")
	}

	func testFadeCompletedFinishes() {
		let model = makeModel(log: MusicLog(), seen: freshSeen())
		model.end(.playedToEnd)

		model.fadeCompleted()

		XCTAssertEqual(model.phase, .finished)
	}

	func testFadeCompletedFromANonFadingPhaseIsIgnored() {
		let model = makeModel(log: MusicLog(), seen: freshSeen())

		model.fadeCompleted()

		XCTAssertEqual(model.phase, .playing)
	}

	func testReplayRestartsTheVideoAndTheMusicFromTheLoginScreen() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())
		model.end(.skipped)

		model.replay()

		XCTAssertEqual(model.phase, .playing, "replay re-enters the intro")
		XCTAssertEqual(log.restarts, 1, "the music restarts with the intro")
	}

	func testReplayWorksOnAReturningLaunchThatNeverPlayedTheIntro() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: consumedSeen())
		XCTAssertEqual(model.phase, .idle)

		model.replay()

		XCTAssertEqual(model.phase, .playing)
		XCTAssertEqual(log.restarts, 1)
	}

	func testReplayKeepsTheMusicMutedWhenTheUserHadMutedIt() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen(), mute: mutePreference(muted: true))

		model.replay()

		XCTAssertEqual(log.muted, true, "a replay honours the saved mute preference")
	}

	func testTogglingMutePersistsAppliesAndFlipsBack() {
		let log = MusicLog()
		let preference = mutePreference(muted: false)
		let model = makeModel(log: log, seen: freshSeen(), mute: preference)

		model.toggleMute()

		XCTAssertTrue(model.isMuted)
		XCTAssertEqual(log.muted, true)
		XCTAssertTrue(preference.isMuted, "the preference is remembered across launches")

		model.toggleMute()

		XCTAssertFalse(model.isMuted)
		XCTAssertEqual(log.muted, false)
		XCTAssertFalse(preference.isMuted)
	}

	func testSyncStopsTheMusicOnLogin() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())

		model.sync(isLoggedIn: true, isForeground: true)

		XCTAssertEqual(log.stops, 1)
	}

	func testSyncStopsTheMusicOnBackgrounding() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())

		model.sync(isLoggedIn: false, isForeground: false)

		XCTAssertEqual(log.stops, 1)
	}

	func testSyncRestartsTheMusicOnReturningToTheForegroundWhileLoggedOut() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())

		model.sync(isLoggedIn: false, isForeground: true)

		XCTAssertEqual(log.starts, 2, "returning from the Chrome OAuth hop resumes the intro music")
	}

	func testTheMusicKeepsLoopingOnTheLoginScreenAcrossABackgroundHopAfterTheVideoFinishes() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())
		model.end(.playedToEnd)
		model.fadeCompleted()

		model.sync(isLoggedIn: false, isForeground: false)
		model.sync(isLoggedIn: false, isForeground: true)

		XCTAssertEqual(model.phase, .finished)
		XCTAssertEqual(log.stops, 1, "backgrounding pauses the theme")
		XCTAssertEqual(log.starts, 2, "the theme resumes while the user is still on the login screen")
	}

	func testTheOverlayReflectsTheCurrentPhase() {
		let model = makeModel(log: MusicLog(), seen: freshSeen())

		XCTAssertEqual(model.overlay, LaunchIntro.overlay(for: model.phase))
	}
}
