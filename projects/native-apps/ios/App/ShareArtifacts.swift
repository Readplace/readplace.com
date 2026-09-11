import Foundation

enum ShareArtifacts {
	static func purge(appGroupId: String) {
		guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return }
		UploadJobStore(containerURL: container).purgeAll()
		UnseenSave(containerURL: container).clear()
		DiscoveryHTTPCache.purge(containerURL: container)
	}

	static func forgetReaderChoices(appGroupId: String) {
		AppGroupContainer.entitled(appGroupId: appGroupId)
			.map(ShareTarget.init(container:))?
			.forget()
		guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
		LastViewedReadlist(defaults: defaults).forget()
	}
}
