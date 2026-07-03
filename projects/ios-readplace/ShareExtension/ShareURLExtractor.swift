import Foundation
import UniformTypeIdentifiers

/// Pulls the shared web URL (and any provided title) out of the share-sheet
/// payload, plus the provider of a PDF the payload carries as a file — Safari's
/// PDF viewer and the Files app share the document itself, not just a link. The
/// PDF's bytes are deliberately not loaded here: `SaveSharedPage` reads them
/// only after its logged-out / no-link guards pass, so a doomed share never
/// pulls up to 25 MiB into the extension's tight memory budget.
/// Main-actor isolated so the non-Sendable extension context / item providers
/// never cross an actor boundary.
@MainActor
enum ShareURLExtractor {
	struct Shared {
		let url: URL?
		let title: String?
		let pdfProvider: NSItemProvider?
	}

	static func extract(from context: NSExtensionContext?) async -> Shared? {
		guard let items = context?.inputItems as? [NSExtensionItem] else { return nil }

		// Scan every item before deciding: a host can deliver the PDF file and
		// the web URL as separate extension items, and the first item alone
		// would look like a URL-less share.
		var url: URL?
		var title: String?
		var pdfProvider: NSItemProvider?
		for item in items {
			let providers = item.attachments ?? []
			if url == nil { url = await webURL(in: providers) }
			if pdfProvider == nil {
				pdfProvider = providers.first { $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) }
			}
			if title == nil { title = item.attributedContentText?.string }
		}

		guard url != nil || pdfProvider != nil else { return nil }
		return Shared(url: url, title: title ?? pdfProvider?.suggestedName, pdfProvider: pdfProvider)
	}

	private static func webURL(in providers: [NSItemProvider]) async -> URL? {
		for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
			if let url = await loadURL(provider), URLDetection.isWebURL(url) { return url }
		}
		for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
			if let text = await loadText(provider), let url = URLDetection.firstWebURL(in: text) {
				return url
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

	/// Reads the shared PDF through a file representation so its size is known
	/// and checked against the extension's byte ceiling before any bytes are
	/// read. The temp file only exists inside the completion handler, so the
	/// read cannot be hoisted out.
	static func loadPDFData(_ provider: NSItemProvider) async -> Data? {
		await withCheckedContinuation { continuation in
			provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { fileURL, _ in
				guard let fileURL,
					let size = try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize,
					size <= ReadplaceAPI.defaultMaxExternalContentBytes,
					let data = try? Data(contentsOf: fileURL)
				else {
					return continuation.resume(returning: nil)
				}
				continuation.resume(returning: data)
			}
		}
	}
}
