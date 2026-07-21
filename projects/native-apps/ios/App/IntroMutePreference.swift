import Foundation

struct IntroMutePreference {
	private let defaults: UserDefaults

	private enum Key {
		static let muted = "launchIntro.muted"
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	var isMuted: Bool {
		defaults.bool(forKey: Key.muted)
	}

	func setMuted(_ muted: Bool) {
		defaults.set(muted, forKey: Key.muted)
	}
}
