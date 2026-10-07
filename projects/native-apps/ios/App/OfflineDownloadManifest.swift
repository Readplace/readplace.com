import Foundation

struct OfflineDownloadRun: Codable, Equatable {
	let total: Int
	let completed: Int

	var isIncomplete: Bool { completed < total }
}

@MainActor
final class OfflineDownloadManifest: ObservableObject {
	private struct Stored: Codable {
		var versions: [String: String]
		var run: OfflineDownloadRun?
	}

	@Published private var stored: Stored
	private let file: URL

	init(container: AppGroupContainer) {
		file = OfflineReadingFiles.directory(in: container).appendingPathComponent("download-manifest.json", isDirectory: false)
		stored = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(Stored.self, from: $0) }
			?? Stored(versions: [:], run: nil)
	}

	var run: OfflineDownloadRun? { stored.run }

	var incompleteRun: OfflineDownloadRun? {
		stored.run.flatMap { $0.isIncomplete ? $0 : nil }
	}

	func isAvailableOffline(_ article: Article) -> Bool {
		isCurrent(articleId: article.id, contentVersion: article.contentVersion)
	}

	func isCurrent(articleId: String, contentVersion: String?) -> Bool {
		guard let contentVersion else { return false }
		return stored.versions[articleId] == contentVersion
	}

	func recordDownloaded(articleId: String, contentVersion: String) {
		stored.versions[articleId] = contentVersion
		persist()
	}

	func record(run: OfflineDownloadRun) {
		stored.run = run
		persist()
	}

	func forgetRun() {
		stored.run = nil
		persist()
	}

	private func persist() {
		try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
		try? JSONEncoder().encode(stored).write(to: file, options: .atomic)
	}
}
