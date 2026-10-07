import UIKit

@MainActor
protocol BackgroundTimeKeeping {
	func begin()
	func end()
}

@MainActor
final class ApplicationBackgroundTime: BackgroundTimeKeeping {
	static let taskName = "Download unread for offline reading"

	private let application: UIApplication
	private(set) var task = UIBackgroundTaskIdentifier.invalid

	init(application: UIApplication) {
		self.application = application
	}

	func begin() {
		task = application.beginBackgroundTask(withName: Self.taskName, expirationHandler: end)
	}

	func end() {
		application.endBackgroundTask(task)
		task = .invalid
	}
}
