import Foundation

enum LaunchIntroEnd: Equatable {
	case playedToEnd
	case assetFailed
	case timedOut
	case skipped
}

enum LaunchIntroPhase: Equatable {
	case idle
	case playing
	case fading
	case finished
}

struct LaunchIntroOverlay: Equatable {
	let showsVideo: Bool
	let opacity: Double
	let usesDarkBackdrop: Bool
}

enum LaunchIntro {
	static func initialPhase(isFirstLaunch: Bool, reduceMotion: Bool) -> LaunchIntroPhase {
		isFirstLaunch && !reduceMotion ? .playing : .idle
	}

	static func overlay(for phase: LaunchIntroPhase) -> LaunchIntroOverlay {
		switch phase {
		case .idle, .finished:
			return LaunchIntroOverlay(showsVideo: false, opacity: 0, usesDarkBackdrop: false)
		case .playing:
			return LaunchIntroOverlay(showsVideo: true, opacity: 1, usesDarkBackdrop: true)
		case .fading:
			return LaunchIntroOverlay(showsVideo: true, opacity: 0, usesDarkBackdrop: false)
		}
	}

	static func next(after phase: LaunchIntroPhase, end: LaunchIntroEnd) -> LaunchIntroPhase {
		guard phase == .playing else { return phase }
		return end == .skipped ? .finished : .fading
	}

	static func playsMusic(isLoggedIn: Bool, isForeground: Bool) -> Bool {
		!isLoggedIn && isForeground
	}

	static let fadeDuration = 0.45

	static let watchdogSlack = 3.0

	static let videoDuration = 8.083333

	static let logoScreenFraction = 0.378
}
