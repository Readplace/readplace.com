import Foundation

struct ShareTarget {
	private let defaults: UserDefaults

	private enum Key {
		static let readlistHref = "shareTarget.readlistHref"
		static let decided = "shareTarget.decided"
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	var href: String? {
		defaults.string(forKey: Key.readlistHref)
	}

	var isDecided: Bool {
		defaults.bool(forKey: Key.decided)
	}

	func record(href: String) {
		defaults.set(href, forKey: Key.readlistHref)
		defaults.set(true, forKey: Key.decided)
	}

	func clear() {
		defaults.removeObject(forKey: Key.readlistHref)
		defaults.set(true, forKey: Key.decided)
	}

	func forget() {
		defaults.removeObject(forKey: Key.readlistHref)
		defaults.removeObject(forKey: Key.decided)
	}
}
