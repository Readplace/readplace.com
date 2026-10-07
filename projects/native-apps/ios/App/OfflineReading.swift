import Foundation
import SwiftUI
import WebKit

enum OfflineReading {
	static let bannerText = "Your internet is not working, your reading is offline. Readplace is read-only until you're back online."

	static let emptyListText = "You're offline. Your reading list will appear once you're back online."

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
