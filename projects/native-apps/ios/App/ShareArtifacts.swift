import Foundation

enum ShareArtifacts {
	static func purge(appGroupId: String) {
		if let defaults = UserDefaults(suiteName: appGroupId) {
			ShareTarget(defaults: defaults).forget()
			LastViewedReadlist(defaults: defaults).forget()
		}
		guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return }
		UploadJobStore(containerURL: container).purgeAll()
		UnseenSave(containerURL: container).clear()
		DiscoveryHTTPCache.purge(containerURL: container)
	}
}
