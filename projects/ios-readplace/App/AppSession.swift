import Foundation
import WebKit

/// Why an authorization callback was rejected before any token exchange.
enum AuthFlowError: LocalizedError {
	case denied(String)
	case missingCode
	case stateMismatch

	var errorDescription: String? {
		switch self {
		case .denied(let reason): return "Authorization was denied (\(reason))."
		case .missingCode: return "No authorization code was returned."
		case .stateMismatch: return "Security check failed (state mismatch)."
		}
	}
}

/// App-wide auth/session state, plus factories so views reach the API and OAuth
/// with current config rather than constructing them with stale values.
@MainActor
final class AppSession: ObservableObject {
	@Published private(set) var isLoggedIn: Bool

	private let store: TokenStore
	private let sessionConfiguration: URLSessionConfiguration
	private let wipeReaderWebStore: () async -> Void

	// Defaults to an ephemeral configuration so the API/OAuth sessions keep their
	// cookie jar in an isolated, in-memory store rather than process-wide
	// `HTTPCookieStorage.shared` — the minted reader session cookie must not linger
	// in the shared jar where it would outlive a sign-out.
	//
	// `wipeReaderWebStore` defaults to the real WebKit deletion; it's the
	// OS-boundary seam tests replace with a spy.
	init(
		store: TokenStore = TokenStore(),
		sessionConfiguration: URLSessionConfiguration = .ephemeral,
		wipeReaderWebStore: @escaping () async -> Void = AppSession.removeReaderWebStoreData
	) {
		self.store = store
		self.sessionConfiguration = sessionConfiguration
		self.wipeReaderWebStore = wipeReaderWebStore
		self.isLoggedIn = store.isLoggedIn
	}

	func refreshLoginState() {
		isLoggedIn = store.isLoggedIn
	}

	/// Completes sign-in: validate the callback, exchange the code for tokens, flip
	/// the session to logged-in.
	///
	/// `redirectURI` must equal the one the authorize request used — the OAuth
	/// server checks it by exact string at token time.
	func completeSignIn(
		callbackURL: URL,
		verifier: String,
		expectedState: String,
		redirectURI: String
	) async -> Result<Void, Error> {
		let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
		func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

		if let error = value("error") { return .failure(AuthFlowError.denied(error)) }
		guard let code = value("code") else { return .failure(AuthFlowError.missingCode) }
		guard value("state") == expectedState else { return .failure(AuthFlowError.stateMismatch) }

		do {
			try await makeOAuth().exchangeCode(code, verifier: verifier, redirectURI: redirectURI)
			refreshLoginState()
			return .success(())
		} catch {
			return .failure(error)
		}
	}

	func logout() async {
		// The WebKit wipe and the network revoke are independent, so they run
		// concurrently; both finish before the logged-out state is published.
		let readerWipe = Task { await self.wipeReaderWebStore() }
		await makeOAuth().revoke()
		clearSessionCookie()
		await readerWipe.value
		isLoggedIn = false
	}

	/// Local sign-out used when the session is already invalid (refresh failed).
	/// Stays synchronous so the non-async `onSessionExpired` caller is unaffected;
	/// the returned wipe task lets tests await the fire-and-forget WebKit wipe.
	@discardableResult
	func forceLogout() -> Task<Void, Never> {
		store.clear()
		clearSessionCookie()
		let readerWipe = Task { await self.wipeReaderWebStore() }
		isLoggedIn = false
		return readerWipe
	}

	/// Clears the API session's isolated cookie jar on sign-out so the minted
	/// browser session cookie doesn't linger for the next sign-in in the same
	/// process. The jar is the configuration's own isolated store (never
	/// `HTTPCookieStorage.shared`), so clearing it wholesale touches only this app's
	/// copy and needs no knowledge of the server's cookie name.
	private func clearSessionCookie() {
		let storage = sessionConfiguration.httpCookieStorage
		for cookie in storage?.cookies ?? [] {
			storage?.deleteCookie(cookie)
		}
	}

	/// Removes the reader's authenticated traces from the process-wide WebKit
	/// default store on sign-out: every cookie scoped to the app's own server host
	/// (whatever the server named the session cookie), so a server cookie rename
	/// needs no app release, plus every non-cookie data type so the signed-out
	/// account's reading history doesn't stay on disk. Scoping the cookie wipe to the
	/// server host leaves cookies for other origins untouched.
	private static func removeReaderWebStoreData() async {
		let store = WKWebsiteDataStore.default()
		if let host = URL(string: AppConfig.serverBaseURL)?.host {
			for cookie in await store.httpCookieStore.allCookies() where cookie.domain.contains(host) {
				await store.httpCookieStore.delete(cookie)
			}
		}
		let nonCookieTypes = WKWebsiteDataStore.allWebsiteDataTypes().subtracting([WKWebsiteDataTypeCookies])
		await store.removeData(ofTypes: nonCookieTypes, modifiedSince: .distantPast)
	}

	func makeAPI() -> ReadplaceAPI {
		ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}

	func makeOAuth() -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}
}
