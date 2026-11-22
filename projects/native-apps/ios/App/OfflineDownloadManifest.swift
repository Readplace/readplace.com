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
		var contentStates: [String: ContentState]

		private enum CodingKeys: String, CodingKey { case versions, run, contentStates }

		init(versions: [String: String], run: OfflineDownloadRun?, contentStates: [String: ContentState]) {
			self.versions = versions
			self.run = run
			self.contentStates = contentStates
		}

		init(from decoder: Decoder) throws {
			let container = try decoder.container(keyedBy: CodingKeys.self)
			versions = try container.decode([String: String].self, forKey: .versions)
			run = try container.decodeIfPresent(OfflineDownloadRun.self, forKey: .run)
			let states = (try? container.decodeIfPresent([String: String].self, forKey: .contentStates)) ?? [:]
			contentStates = states.compactMapValues(ContentState.init(rawValue:))
		}
	}

	@Published private var stored: Stored
	private let file: URL

	init(container: AppGroupContainer) {
		file = OfflineReadingFiles.directory(in: container).appendingPathComponent("download-manifest.json", isDirectory: false)
		stored = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(Stored.self, from: $0) }
			?? Stored(versions: [:], run: nil, contentStates: [:])
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

	func recordDownloaded(articleId: String, contentVersion: String, contentState: ContentState?) {
		stored.versions[articleId] = contentVersion
		stored.contentStates[articleId] = contentState
		persist()
	}

	func record(contentState: ContentState?, articleId: String) {
		guard stored.contentStates[articleId] != contentState else { return }
		stored.contentStates[articleId] = contentState
		persist()
	}

	func contentState(articleId: String) -> ContentState? {
		stored.contentStates[articleId]
	}

	func hasArticlesWithoutContent(among articleIds: [String]) -> Bool {
		articleIds.contains { stored.contentStates[$0]?.lacksContent == true }
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
