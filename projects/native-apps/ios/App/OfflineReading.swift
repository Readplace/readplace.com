import Foundation
import SwiftUI
import WebKit

enum OfflineReading {
	static let bannerText = "Your internet is not working, your reading is offline. Readplace is read-only until you're back online."

	static let emptyListText = "You're offline. Your reading list will appear once you're back online."

	static let listProcessingText =
		"Some of these articles weren't downloaded with their content. Open them when you're back online to read them."

	static let listUnavailableText =
		"Readplace couldn't get the content of some of these articles, so they can't be read offline."

	static let readerProcessingText =
		"This article wasn't downloaded with its content. Open it when you're back online to read it."

	static let readerUnavailableText = "Readplace couldn't get this article's content, so it can't be read offline."

	static func listContentBannerText(states: Set<ContentState>) -> String? {
		let texts = [
			states.contains(.processing) ? listProcessingText : nil,
			states.contains(.unavailable) ? listUnavailableText : nil,
		].compactMap { $0 }
		return texts.isEmpty ? nil : texts.joined(separator: "\n")
	}

	static func readerContentBannerText(for state: ContentState?) -> String? {
		switch state {
		case .processing: return readerProcessingText
		case .unavailable: return readerUnavailableText
		case .available, nil: return nil
		}
	}

	static let downloadControlTint: Color? = nil

	static func isTransportFailure(_ error: Error) -> Bool {
		if case OAuthError.refreshUnreachable(let underlying) = error { return isTransportFailure(underlying) }
		guard let urlError = error as? URLError else { return false }
		return urlError.code != .cancelled
	}

	static func cachePolicy(offline: Bool) -> URLRequest.CachePolicy {
		offline ? .returnCacheDataElseLoad : .useProtocolCachePolicy
	}

	static func userScripts(for policy: URLRequest.CachePolicy) -> [WKUserScript] {
		guard policy == cachePolicy(offline: true) else { return [] }
		return [WKUserScript(source: eagerImages, injectionTime: .atDocumentEnd, forMainFrameOnly: true)]
	}

	private static let eagerImages =
		"document.querySelectorAll('img[loading=\"lazy\"]').forEach(function (image) { image.loading = 'eager'; });"
}
