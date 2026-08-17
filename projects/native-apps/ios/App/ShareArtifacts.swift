import Foundation

enum ShareArtifacts {
	static func purge(appGroupId: String) {
		guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return }
		UploadJobStore(containerURL: container).purgeAll()
		DiscoveryHTTPCache.purge(containerURL: container)
	}
}
