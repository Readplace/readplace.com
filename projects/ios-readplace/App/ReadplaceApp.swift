import SwiftUI

@main
struct ReadplaceApp: App {
	@StateObject private var session = AppSession()

	var body: some Scene {
		WindowGroup {
			RootView()
				.environmentObject(session)
		}
	}
}

struct RootView: View {
	@EnvironmentObject private var session: AppSession
	@State private var authErrorText: String?

	var body: some View {
		Group {
			if session.isLoggedIn {
				ReadingListView(session: session)
			} else {
				LoginView(authErrorText: $authErrorText)
			}
		}
		.tint(.brandAmber)
		.onOpenURL { url in
			guard url.scheme == AppConfig.callbackURLScheme, url.host == AppConfig.nativeCallbackHost else { return }
			Task { @MainActor in
				// A tampered callback (wrong/absent state or code) is rejected inside
				// completeSignIn; nil means no pending auth, so the deep link is ignored.
				guard let result = await makeWebAuthFlow(session: session).complete(url) else { return }
				if case .failure(let error) = result {
					authErrorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
				}
			}
		}
	}
}
