import Foundation
import os

/// What the server publishes at `/slogans`. Decoded as an object rather than a
/// bare array so the server can add a sibling field without breaking a shipped
/// build.
private struct SlogansPayload: Decodable {
	let slogans: [String]
}

/// The seam the sign-in screen reads its slogans through, injected so tests never
/// hit the network. A struct of closures, matching `WebAuthFlow` and `IntroMusic`.
struct SloganSource {
	let load: () async -> [String]
}

private let sloganLogger = Logger(subsystem: "com.readplace.app", category: "slogans")

/// Partial application (`init*`) wiring a URL session into a `SloganSource`.
///
/// Sign-in runs before there is an access token, so this deliberately does not go
/// through `ReadplaceAPI`, whose every request presents a Bearer token and fails
/// without one.
///
/// Every failure — transport, status, media type, malformed body — answers with an
/// empty list rather than throwing. The caller's fallback slogan is already the
/// right answer for all of them, and a slogan is not worth an error on the screen
/// a user is trying to sign in from.
func initSloganSource(
	sessionConfiguration: URLSessionConfiguration,
	baseURL: String
) -> SloganSource {
	let session = URLSession(configuration: sessionConfiguration)
	return SloganSource(load: {
		guard let url = Href.resolve(AppConfig.slogansPath, baseURL: baseURL) else { return [] }
		var request = URLRequest(url: url)
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		request.setValue(AppConfig.clientIos, forHTTPHeaderField: AppConfig.clientHeader)
		do {
			let (data, response) = try await session.data(for: request)
			guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return [] }
			guard MediaType.matches(http.value(forHTTPHeaderField: "Content-Type"), "application/json") else {
				return []
			}
			let payload = try JSONDecoder().decode(SlogansPayload.self, from: data)
			return payload.slogans.filter { !$0.isEmpty }
		} catch {
			sloganLogger.error("slogan fetch failed: \(String(describing: error), privacy: .private)")
			return []
		}
	})
}
