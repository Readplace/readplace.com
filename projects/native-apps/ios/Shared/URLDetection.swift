import Foundation

/// Finds the first http/https URL in free text. Non-web schemes (mailto:, tel:,
/// etc.) are ignored so the share extension never POSTs a URL the server would
/// reject for an unsupported scheme.
enum URLDetection {
	static func firstWebURL(in text: String) -> URL? {
		guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
			return nil
		}
		let range = NSRange(text.startIndex..<text.endIndex, in: text)
		for match in detector.matches(in: text, options: [], range: range) {
			if let url = match.url, isWebURL(url) {
				return url
			}
		}
		return nil
	}

	/// A shared PDF's attachment also registers `public.file-url`, so a loaded
	/// URL item can be a `file:` path into another app's sandbox — never a valid
	/// article key.
	static func isWebURL(_ url: URL) -> Bool {
		guard let scheme = url.scheme?.lowercased() else { return false }
		return scheme == "http" || scheme == "https"
	}
}
