import Foundation

struct LastViewedReadlist {
	private let defaults: UserDefaults

	private enum Key {
		static let readlistHref = "readingList.lastViewedReadlistHref"
		static let landingTabHref = "readingList.lastViewedLandingTabHref"
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	var href: String? {
		defaults.string(forKey: Key.readlistHref)
	}

	var landingTabHref: String? {
		defaults.string(forKey: Key.landingTabHref)
	}

	func remember(href: String) {
		defaults.set(href, forKey: Key.readlistHref)
	}

	func remember(landingTabHref: String?) {
		defaults.set(landingTabHref, forKey: Key.landingTabHref)
	}

	func forget() {
		defaults.removeObject(forKey: Key.readlistHref)
		defaults.removeObject(forKey: Key.landingTabHref)
	}
}
