import Foundation

/// Starts one staged upload on a transport whose life is not the share sheet's.
/// The seam exists so the save journey can be driven without an OS session.
protocol BackgroundUploading {
	func upload(_ request: URLRequest, fromFile file: URL)
}

/// Every decision the `save-content` upload needs, made where a test can read it:
/// the session's identity and configuration, and the request itself. What is left
/// in `BackgroundUploadScheduler` is the OS call that cannot be decided about.
enum BackgroundUpload {
	static let sessionIdentifierPrefix = "com.readplace.ShareExtension.upload."

	/// Fresh per run: the system lets only one process at a time own a background
	/// session with a given identifier, and the app is relaunched — while the
	/// extension may still be alive — to finish what the extension started.
	static func freshSessionIdentifier() -> String {
		"\(sessionIdentifierPrefix)\(UUID().uuidString)"
	}

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

	/// The single `save-content` POST the background session executes, or nil when
	/// the server's href is not one this client follows. The bearer is attached
	/// here, moments after a `send()` that would already have refreshed it; the
	/// background path carries no refresh machinery, so an upload whose token
	/// expires before the system runs it is simply dropped.
	static func request(
		action: SirenAction,
		baseURL: String,
		contentType: String,
		accessToken: String
	) -> URLRequest? {
		guard let href = action.href, let url = Href.resolve(href, baseURL: baseURL) else { return nil }
		var request = URLRequest(url: url)
		request.httpMethod = action.method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		// The server answers `save-content` with 406 unless the request accepts Siren,
		// and this path carries none of the foreground `send()` that would add it.
		request.setValue(AppConfig.sirenMediaType, forHTTPHeaderField: "Accept")
		request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
		request.setValue(AppConfig.clientIos, forHTTPHeaderField: AppConfig.clientHeader)
		request.setValue(AppConfig.saveContinuityBackground, forHTTPHeaderField: AppConfig.saveContinuityHeader)
		return request
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

/// The OS boundary itself: hand a request and a file to a session and let go.
/// The session is built on first use, so a share that never reaches an upload —
/// signed out, no link, a render that missed its window — registers none with the
/// system.
final class BackgroundUploadScheduler: BackgroundUploading {
	private let makeSession: () -> URLSession
	private lazy var session: URLSession = makeSession()

	init(makeSession: @escaping () -> URLSession) {
		self.makeSession = makeSession
	}

	func upload(_ request: URLRequest, fromFile file: URL) {
		let task = session.uploadTask(with: request, fromFile: file)
		task.taskDescription = file.lastPathComponent
		task.resume()
	}
}
