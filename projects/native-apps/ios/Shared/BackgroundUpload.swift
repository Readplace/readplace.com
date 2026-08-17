import Foundation

/// What a background upload an earlier build started still needs from this one:
/// the session's identity and configuration, so the app can re-attach to the
/// session the system relaunched it for.
enum BackgroundUpload {
	static let sessionIdentifierPrefix = "com.readplace.ShareExtension.upload."

	/// Whether an identifier the system handed back names one of our uploads. The
	/// app must drain the completion handler for any identifier, so this only
	/// decides whether there is a session of ours worth re-attaching to.
	static func isUploadSession(_ identifier: String) -> Bool {
		identifier.hasPrefix(sessionIdentifierPrefix)
	}

	static func sessionConfiguration(identifier: String, appGroupId: String) -> URLSessionConfiguration {
		let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
		configuration.sharedContainerIdentifier = appGroupId
		return configuration
	}
}

/// What the app owes an upload the share extension started. A seam rather than a
/// free function because it hands over an escaping handler, and because the app
/// delegate is otherwise untestable.
protocol BackgroundSessionEvents {
	func resume(sessionIdentifier: String, whenDrained: @escaping () -> Void)
}

struct SharedContainerUploads: BackgroundSessionEvents {
	/// Drains the handler the system is waiting on even for a session that is none
	/// of ours — the system requires the call regardless — and only re-attaches
	/// when there is a session of ours whose staged body needs releasing.
	func resume(sessionIdentifier: String, whenDrained: @escaping () -> Void) {
		guard BackgroundUpload.isUploadSession(sessionIdentifier),
			let staging = UploadStaging.inSharedContainer(appGroupId: TokenStore.resolvedAppGroupId)
		else { return whenDrained() }
		UploadSessionDelegate.reattach(
			to: BackgroundUpload.sessionConfiguration(identifier: sessionIdentifier, appGroupId: TokenStore.resolvedAppGroupId),
			staging: staging,
			whenDrained: whenDrained
		)
	}
}
