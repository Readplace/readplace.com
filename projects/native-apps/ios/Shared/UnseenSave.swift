import Foundation

/// Word the share extension leaves in the App Group that a save landed which the
/// app's list has not shown yet. The reading list consumes it to decide that a
/// deep-scrolled (paginated) list is worth re-reading on return — the one case
/// where converging costs the reader their scroll position, so it must be
/// justified by an actual save rather than performed on every return. Presence
/// is the whole signal; any successful first-page read clears it, because the
/// list now holds server truth.
struct UnseenSave {
	private let markerURL: URL

	init(containerURL: URL) {
		markerURL = containerURL.appendingPathComponent(
			"Library/Application Support/unseen-save", isDirectory: false
		)
	}

	static func inSharedContainer(appGroupId: String) -> UnseenSave? {
		FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
			.map(UnseenSave.init(containerURL:))
	}

	/// A failure to record costs only the automatic refresh — the save itself has
	/// already succeeded — so it must never fail the share journey.
	func record() {
		try? FileManager.default.createDirectory(
			at: markerURL.deletingLastPathComponent(), withIntermediateDirectories: true
		)
		try? Data().write(to: markerURL, options: .atomic)
	}

	var exists: Bool {
		FileManager.default.fileExists(atPath: markerURL.path)
	}

	func clear() {
		try? FileManager.default.removeItem(at: markerURL)
	}
}
