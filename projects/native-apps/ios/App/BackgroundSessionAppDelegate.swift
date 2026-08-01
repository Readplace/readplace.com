import UIKit

/// The app's half of a save the share extension started. The app owns no upload
/// of its own, but the system relaunches the *app* — never the extension — once a
/// background session's events are ready, so the app is the only process that can
/// re-attach to that session and let go of the body it staged.
@MainActor
final class BackgroundSessionAppDelegate: NSObject, UIApplicationDelegate {
	private let events: BackgroundSessionEvents

	override convenience init() {
		self.init(events: SharedContainerUploads())
	}

	init(events: BackgroundSessionEvents) {
		self.events = events
		super.init()
	}

	func application(
		_ application: UIApplication,
		handleEventsForBackgroundURLSession identifier: String,
		completionHandler: @escaping () -> Void
	) {
		events.resume(sessionIdentifier: identifier, whenDrained: completionHandler)
	}
}
