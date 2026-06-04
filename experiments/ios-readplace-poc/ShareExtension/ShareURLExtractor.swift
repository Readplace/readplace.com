import Foundation
import UniformTypeIdentifiers

/// Pulls the shared URL (and any provided title) out of the share-sheet payload.
/// Main-actor isolated so the non-Sendable extension context / item providers
/// never cross an actor boundary.
@MainActor
enum ShareURLExtractor {
	struct Shared {
		let url: URL
		let title: String?
	}

	static func extract(from context: NSExtensionContext?) async -> Shared? {
		guard let items = context?.inputItems as? [NSExtensionItem] else { return nil }
		for item in items {
			let title = item.attributedContentText?.string
			let providers = item.attachments ?? []

			for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
				if let url = await loadURL(provider) { return Shared(url: url, title: title) }
			}
			for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
				if let text = await loadText(provider), let url = URLDetection.firstWebURL(in: text) {
					return Shared(url: url, title: title)
				}
			}
		}
		return nil
	}

	private static func loadURL(_ provider: NSItemProvider) async -> URL? {
		await withCheckedContinuation { continuation in
			provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
				if let url = item as? URL {
					continuation.resume(returning: url)
				} else if let data = item as? Data, let url = URL(dataRepresentation: data, relativeTo: nil) {
					continuation.resume(returning: url)
				} else if let string = item as? String, let url = URL(string: string) {
					continuation.resume(returning: url)
				} else {
					continuation.resume(returning: nil)
				}
			}
		}
	}

	private static func loadText(_ provider: NSItemProvider) async -> String? {
		await withCheckedContinuation { continuation in
			provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
				continuation.resume(returning: item as? String)
			}
		}
	}
}
