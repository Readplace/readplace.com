import Foundation

@MainActor
final class LaunchIntroModel: ObservableObject {
	@Published private(set) var phase: LaunchIntroPhase
	@Published private(set) var isMuted: Bool
	private let music: IntroMusic
	private let mutePreference: IntroMutePreference

	init(seen: LaunchIntroSeen, music: IntroMusic, mutePreference: IntroMutePreference, reduceMotion: Bool) {
		self.music = music
		self.mutePreference = mutePreference
		self.isMuted = mutePreference.isMuted
		self.phase = LaunchIntro.initialPhase(isFirstLaunch: seen.claim(), reduceMotion: reduceMotion)
		music.setMuted(isMuted)
		if LaunchIntro.playsMusic(phase: phase, isLoggedIn: false, isForeground: true) {
			music.start()
		}
	}

	var overlay: LaunchIntroOverlay {
		LaunchIntro.overlay(for: phase)
	}

	func end(_ reason: LaunchIntroEnd) {
		phase = LaunchIntro.next(after: phase, end: reason)
		if reason == .skipped {
			music.seek(LaunchIntro.videoDuration)
		}
	}

	func fadeCompleted() {
		guard phase == .fading else { return }
		phase = .finished
	}

	func replay() {
		phase = .playing
		music.setMuted(isMuted)
		music.restart()
	}

	func toggleMute() {
		isMuted.toggle()
		mutePreference.setMuted(isMuted)
		music.setMuted(isMuted)
	}

	func sync(isLoggedIn: Bool, isForeground: Bool) {
		if LaunchIntro.playsMusic(phase: phase, isLoggedIn: isLoggedIn, isForeground: isForeground) {
			music.start()
		} else {
			music.stop()
		}
	}
}
