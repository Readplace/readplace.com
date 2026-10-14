import Foundation

struct AutomaticCaptureAttempts {
	private let defaults: UserDefaults

	private enum Key {
		static func attempted(articleId: String) -> String {
			"automaticCapture.attempted.\(articleId)"
		}
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	func claim(articleId: String) -> Bool {
		let key = Key.attempted(articleId: articleId)
		guard !defaults.bool(forKey: key) else { return false }
		defaults.set(true, forKey: key)
		return true
	}
}
