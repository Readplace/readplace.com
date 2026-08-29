import Foundation
import os

/// Shared by both processes that can own a background upload: the share extension
/// that starts it, and the app the system relaunches to finish it. A terminal
/// failure shows the user nothing — the article is already saved and the server's
/// crawl produced its content — so the work here is a log the next investigation
/// can read, releasing the staged body, and keeping the client's headers across a
/// redirect.
final class UploadSessionDelegate: NSObject, URLSessionTaskDelegate {
	private static let logger = Logger(subsystem: "com.readplace", category: "UploadSession")

	private let staging: UploadStaging
	/// The system handler the app must call once the session's events are drained;
	/// nil in the extension, which the system never relaunches for events.
	private let whenDrained: (() -> Void)?
	/// Holds the session the re-attach created, which nothing else references.
	private var session: URLSession?

	init(staging: UploadStaging, whenDrained: (() -> Void)?) {
		self.staging = staging
		self.whenDrained = whenDrained
	}

	/// Delivers the re-attached session's callbacks on the main readlist, which is
	/// where the system requires its completion handler to be called.
	static func reattach(
		to configuration: URLSessionConfiguration,
		staging: UploadStaging,
		whenDrained: @escaping () -> Void
	) {
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: whenDrained)
		delegate.session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: .main)
	}

	/// What a completed upload is worth logging, or nil when it succeeded. The
	/// status is read alongside the error because URLSession reports a refusal — a
	/// 406 from a request that lost its `Accept`, a 401 from an expired bearer — as a
	/// transport that *worked*: `error` is nil, and the rejection is in the response.
	static func failure(error: Error?, response: URLResponse?) -> String? {
		if let error { return error.localizedDescription }
		guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return nil }
		return "the server refused it with \(http.statusCode)"
	}

	func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
		if let failure = Self.failure(error: error, response: task.response) {
			Self.logger.error("save-content upload failed: \(failure, privacy: .private)")
		}
		task.taskDescription.map(staging.remove(named:))
	}

	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		completionHandler(RedirectHeaders.preserving(from: task.originalRequest, onto: request))
	}

	func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
		whenDrained?()
		self.session?.finishTasksAndInvalidate()
		self.session = nil
	}
}
