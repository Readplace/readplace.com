import Foundation

/// Where a save's captured content waits for the background session that carries
/// it. The body must live in the App Group container: the upload runs in a system
/// daemon long after the share extension is gone, and only a shared container is
/// readable from there.
///
/// The write is `async` and belongs to no actor, so it runs off the caller's: it
/// is made from the share sheet's main actor while its sheet is still animating,
/// and a 25 MB body would stall that frame.
struct UploadStaging {
	private let directory: URL

	init(containerURL: URL) {
		directory = containerURL.appendingPathComponent("Library/Caches/share-uploads", isDirectory: true)
	}

	/// Staging inside the App Group container this process is entitled to, or nil
	/// when there is no such container — in which case the link is already saved
	/// and only the enrichment upload is lost.
	static func inSharedContainer(appGroupId: String) -> UploadStaging? {
		FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId).map(UploadStaging.init(containerURL:))
	}

	func stage(_ form: MultipartForm) async throws -> URL {
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		let file = directory.appendingPathComponent("\(UUID().uuidString).multipart")
		try form.write(to: file)
		return file
	}

	/// Deletes one staged body by the name the upload task carries, so the delete
	/// resolves through the directory this process owns rather than a path baked
	/// into a task that may outlive its process.
	func remove(named name: String) {
		try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
	}
}
