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
		mute: IntroMutePreference? = nil,
		isLoggedIn: Bool = false
	) -> LaunchIntroModel {
		LaunchIntroModel(
			seen: seen,
			music: makeSpy(log),
			mutePreference: mute ?? mutePreference(),
			reduceMotion: reduceMotion,
			isLoggedIn: isLoggedIn
		)
	}

	func testAFirstLaunchStartsTheMusicImmediately() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen())

		XCTAssertEqual(model.phase, .playing)
		XCTAssertEqual(log.starts, 1)
	}

	func testAReturningLoggedOutLaunchStartsTheLoginMusicWithoutTheVideo() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: consumedSeen())

		XCTAssertEqual(model.phase, .idle, "the video is once per install")
		XCTAssertEqual(log.starts, 1, "the theme is standing login-screen music, not the video's soundtrack")
	}

	func testAReduceMotionLaunchPlaysTheMusicButNotTheVideo() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen(), reduceMotion: true)

		XCTAssertEqual(model.phase, .idle, "reduce motion suppresses the video")
		XCTAssertEqual(log.starts, 1, "reduce motion is a motion setting, not an audio one")
	}

	func testAReturningLaunchByALoggedInUserStartsNothing() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: consumedSeen(), isLoggedIn: true)

		XCTAssertEqual(model.phase, .idle)
		XCTAssertEqual(log.starts, 0, "there is no login screen to score")
	}

	func testAFirstLaunchWhileLoggedInPlaysTheVideoSilently() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: freshSeen(), isLoggedIn: true)

		XCTAssertEqual(model.phase, .playing)
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

	func testReplayUnmutesTheMusicAndRemembersIt() {
		let log = MusicLog()
		let preference = mutePreference(muted: true)
		let model = makeModel(log: log, seen: freshSeen(), mute: preference)
		XCTAssertTrue(model.isMuted, "started muted from the saved preference")

		model.replay()

		XCTAssertFalse(model.isMuted, "opening the video unmutes")
		XCTAssertFalse(preference.isMuted, "and the unmute is remembered")
		XCTAssertEqual(log.muted, false)
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

		XCTAssertEqual(log.starts, 2, "returning to the foreground while logged out resumes the intro music")
	}

	func testSyncStartsTheLoginMusicAfterLogout() {
		let log = MusicLog()
		let model = makeModel(log: log, seen: consumedSeen(), isLoggedIn: true)
		XCTAssertEqual(log.starts, 0, "a logged-in launch is silent")

		model.sync(isLoggedIn: false, isForeground: true)

		XCTAssertEqual(log.starts, 1, "logging out lands on the login screen, which has its music")
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
