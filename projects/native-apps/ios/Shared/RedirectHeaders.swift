import Foundation

/// Re-attaches the headers the client sets itself when a redirect is followed.
/// URLSession strips `Authorization` on a cross-origin redirect and may drop
/// custom headers generally, and the server redirects the entry point to the
/// collection — so a followed redirect that lost them would arrive unauthenticated,
/// unnegotiated, and unattributed to this client.
enum RedirectHeaders {
	static let preserved = [
		"Authorization",
		"Accept",
		AppConfig.clientHeader,
		AppConfig.saveContinuityHeader,
	]

	static func preserving(from original: URLRequest?, onto redirected: URLRequest) -> URLRequest {
		var updated = redirected
		for header in preserved {
			if let value = original?.value(forHTTPHeaderField: header) {
				updated.setValue(value, forHTTPHeaderField: header)
			}
		}
		return updated
	}
}
