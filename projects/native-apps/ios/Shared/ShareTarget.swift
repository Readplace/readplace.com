import Foundation

struct ShareTarget {
	private let defaults: UserDefaults

	private enum Key {
		static let readlistHrefs = "shareTarget.readlistHrefs"
		static let singleReadlistHref = "shareTarget.readlistHref"
		static let decided = "shareTarget.decided"
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	var hrefs: Set<String> {
		if let recorded = defaults.stringArray(forKey: Key.readlistHrefs) { return Set(recorded) }
		return Set([defaults.string(forKey: Key.singleReadlistHref)].compactMap { $0 })
	}

	var isDecided: Bool {
		defaults.bool(forKey: Key.decided)
	}

	func record(hrefs: Set<String>) {
		defaults.set(hrefs.sorted(), forKey: Key.readlistHrefs)
		defaults.set(true, forKey: Key.decided)
	}

	func add(href: String) {
		record(hrefs: hrefs.union([href]))
	}

	func remove(href: String) {
		record(hrefs: hrefs.subtracting([href]))
	}

	func forget() {
		defaults.removeObject(forKey: Key.readlistHrefs)
		defaults.removeObject(forKey: Key.singleReadlistHref)
		defaults.removeObject(forKey: Key.decided)
	}
}
