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
	private let wipeReaderSessionCookie: (@escaping () -> Void) -> Void

	// Defaults to an ephemeral configuration so the API/OAuth sessions keep their
	// cookie jar in an isolated, in-memory store rather than process-wide
	// `HTTPCookieStorage.shared` — the minted `hutch_sid` reader cookie must not
	// linger in the shared jar where it would outlive a sign-out.
	//
	// `wipeReaderSessionCookie` defaults to the real WebKit deletion; it's the
	// OS-boundary seam tests replace with a spy.
	init(
		store: TokenStore = TokenStore(),
		sessionConfiguration: URLSessionConfiguration = .ephemeral,
		wipeReaderSessionCookie: @escaping (@escaping () -> Void) -> Void = AppSession.deleteReaderSessionCookieFromWebKit
	) {
		self.store = store
		self.sessionConfiguration = sessionConfiguration
		self.wipeReaderSessionCookie = wipeReaderSessionCookie
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
		await makeOAuth().revoke()
		clearSessionCookie()
		await wipeReaderSession()
		isLoggedIn = false
	}

	/// Local sign-out used when the session is already invalid (refresh failed).
	/// Stays synchronous so the non-async `onSessionExpired` caller is unaffected;
	/// the WebKit wipe is fire-and-forget (enqueued before `isLoggedIn` flips).
	func forceLogout() {
		store.clear()
		clearSessionCookie()
		wipeReaderSessionCookie {}
		isLoggedIn = false
	}

	/// Bridges the completion-based WebKit wipe to async so `logout()` enqueues
	/// the `hutch_sid` deletion before flipping `isLoggedIn` (and any re-login
	/// navigation that follows it).
	private func wipeReaderSession() async {
		await withCheckedContinuation { continuation in
			wipeReaderSessionCookie { continuation.resume() }
		}
	}

	/// Drops the minted browser session cookie (`hutch_sid`) on sign-out so it
	/// doesn't linger in the API session's cookie jar for the next sign-in in the
	/// same process. The jar is the configuration's own isolated store (never
	/// `HTTPCookieStorage.shared`), so this clears only this app's copy.
	private func clearSessionCookie() {
		let storage = sessionConfiguration.httpCookieStorage
		for cookie in storage?.cookies ?? [] where cookie.name == AppConfig.sessionCookieName {
			storage?.deleteCookie(cookie)
		}
	}

	/// Deletes only `hutch_sid` from the process-wide WebKit default store the
	/// reader (`ReaderWebView`) now persists into. Name-scoped on purpose: a
	/// blanket `removeData(ofTypes: [WKWebsiteDataTypeCookies])` would also drop
	/// the reader's `rp_changelog_dismissed` cookie and make the dismissed
	/// changelog banner reappear after sign-out. The real WebKit call is the
	/// OS boundary; tests inject a spy via `wipeReaderSessionCookie`.
	private static func deleteReaderSessionCookieFromWebKit(completion: @escaping () -> Void) {
		let store = WKWebsiteDataStore.default().httpCookieStore
		store.getAllCookies { cookies in
			let group = DispatchGroup()
			for cookie in cookies where cookie.name == AppConfig.sessionCookieName {
				group.enter()
				store.delete(cookie) { group.leave() }
			}
			group.notify(queue: .main, execute: completion)
		}
	}

	func makeAPI() -> ReadplaceAPI {
		ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}

	func makeOAuth() -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}
}
