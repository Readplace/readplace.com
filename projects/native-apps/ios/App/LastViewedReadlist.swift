import Foundation

struct LastViewedReadlist {
	private let defaults: UserDefaults

	private enum Key {
		static let readlistHref = "readingList.lastViewedReadlistHref"
		static let homeHref = "readingList.cachedHomeHref"
		static let currentTabHref = "readingList.cachedCurrentTabHref"
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

	var homeHref: String? { defaults.string(forKey: Key.homeHref) }
	var currentTabHref: String? { defaults.string(forKey: Key.currentTabHref) }

	func remember(homeHref: String?, currentTabHref: String?) {
		defaults.set(homeHref, forKey: Key.homeHref)
		defaults.set(currentTabHref, forKey: Key.currentTabHref)
	}

	func forget() {
		defaults.removeObject(forKey: Key.homeHref)
		defaults.removeObject(forKey: Key.currentTabHref)
		defaults.removeObject(forKey: Key.readlistHref)
		defaults.removeObject(forKey: Key.landingTabHref)
	}
}
