import Foundation

struct LastViewedReadlist {
	private let defaults: UserDefaults

	private enum Key {
		static let readlistHref = "readingList.lastViewedReadlistHref"
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	var href: String? {
		defaults.string(forKey: Key.readlistHref)
	}

	func remember(href: String) {
		defaults.set(href, forKey: Key.readlistHref)
	}

	func forget() {
		defaults.removeObject(forKey: Key.readlistHref)
	}
}
