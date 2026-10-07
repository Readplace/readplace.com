import CryptoKit
import Foundation

enum OfflineReadingFiles {
	static func directory(in container: AppGroupContainer) -> URL {
		container.url
			.appendingPathComponent("Library/Application Support", isDirectory: true)
			.appendingPathComponent("offline-reading", isDirectory: true)
	}

	static func purge(in container: AppGroupContainer) {
		try? FileManager.default.removeItem(at: directory(in: container))
	}
}

struct OfflineReadlistSnapshot {
	private struct Stored: Codable {
		let href: String
		let savedAt: Date
		let body: Data
	}

	private static let entryPoint = "/"

	private let directory: URL

	init(container: AppGroupContainer) {
		directory = OfflineReadingFiles.directory(in: container).appendingPathComponent("readlist-pages", isDirectory: true)
	}

	func save(_ page: ReadlistPage, href: String?, savedAt: Date) {
		guard let body = page.sirenBody else { return }
		let key = href ?? Self.entryPoint
		write(Stored(href: key, savedAt: savedAt, body: body))
		if href == nil, let current = page.currentTabHref {
			write(Stored(href: current, savedAt: savedAt, body: body))
		}
	}

	func page(href: String?, now: Date) -> ReadlistPage? {
		guard let data = try? Data(contentsOf: file(for: href ?? Self.entryPoint)),
			let stored = try? JSONDecoder().decode(Stored.self, from: data),
			OfflineCopy.isShowable(savedAt: stored.savedAt, now: now),
			let collection = try? JSONDecoder().decode(SirenCollection.self, from: stored.body)
		else { return nil }
		return ReadlistPage(collection: collection, sirenBody: stored.body, isStoredCopy: true)
	}

	private func write(_ stored: Stored) {
		try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		try? JSONEncoder().encode(stored).write(to: file(for: stored.href), options: .atomic)
	}

	private func file(for href: String) -> URL {
		let digest = SHA256.hash(data: Data(href.utf8)).map { String(format: "%02x", $0) }.joined()
		return directory.appendingPathComponent("\(digest).json", isDirectory: false)
	}
}
