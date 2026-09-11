import Foundation

enum SharedArticlesDropChoice: AppGroupValue {
	case unasked
	case chosen(hrefs: Set<String>)

	static let fileName = "shared-articles-drop.json"
	static let unwritten = SharedArticlesDropChoice.unasked

	var hrefs: Set<String> {
		guard case .chosen(let hrefs) = self else { return [] }
		return hrefs
	}

	var isDecided: Bool {
		guard case .chosen = self else { return false }
		return true
	}

	private enum EarlierBuildKey {
		static let readlistHrefs = "shareTarget.readlistHrefs"
		static let singleReadlistHref = "shareTarget.readlistHref"
		static let decided = "shareTarget.decided"
	}

	static func recordedByAnEarlierBuild(in defaults: UserDefaults) -> SharedArticlesDropChoice? {
		if let recorded = defaults.stringArray(forKey: EarlierBuildKey.readlistHrefs) {
			return .chosen(hrefs: Set(recorded))
		}
		if let single = defaults.string(forKey: EarlierBuildKey.singleReadlistHref) {
			return .chosen(hrefs: [single])
		}
		guard defaults.bool(forKey: EarlierBuildKey.decided) else { return nil }
		return .chosen(hrefs: [])
	}

	static func forgetEarlierBuild(in defaults: UserDefaults) {
		defaults.removeObject(forKey: EarlierBuildKey.readlistHrefs)
		defaults.removeObject(forKey: EarlierBuildKey.singleReadlistHref)
		defaults.removeObject(forKey: EarlierBuildKey.decided)
	}
}

typealias ShareTarget = AppGroupStore<SharedArticlesDropChoice>

extension AppGroupStore where Value == SharedArticlesDropChoice {
	static func inSharedContainer(_ container: AppGroupContainer, appGroupId: String) -> ShareTarget {
		let earlierBuild = UserDefaults(suiteName: appGroupId)
		let target = ShareTarget(container: container).adoptingLegacy {
			earlierBuild.flatMap(SharedArticlesDropChoice.recordedByAnEarlierBuild(in:))
		}
		if let earlierBuild {
			SharedArticlesDropChoice.forgetEarlierBuild(in: earlierBuild)
		}
		return target
	}

	var hrefs: Set<String> { stored.hrefs }

	var isDecided: Bool { stored.isDecided }

	func record(hrefs: Set<String>) {
		update { _ in .chosen(hrefs: hrefs) }
	}

	func add(href: String) {
		update { .chosen(hrefs: $0.hrefs.union([href])) }
	}

	func remove(href: String) {
		update { .chosen(hrefs: $0.hrefs.subtracting([href])) }
	}

	func forget() {
		update { _ in .unasked }
	}
}
