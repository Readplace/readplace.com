import Foundation

struct LaunchIntroSeen {
	private let defaults: UserDefaults

	private enum Key {
		static let seen = "launchIntro.seen"
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	func claim() -> Bool {
		guard !defaults.bool(forKey: Key.seen) else { return false }
		defaults.set(true, forKey: Key.seen)
		return true
	}
}
