import SwiftUI

@main
struct ReadplacePOCApp: App {
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
		.onOpenURL { url in
			guard url.scheme == AppConfig.callbackURLScheme, url.host == AppConfig.nativeCallbackHost else { return }
			Task { @MainActor in
				// `nil` means no pending auth — an unexpected deep link, ignored.
				// A malformed or hijacked callback (wrong/absent state or code) is
				// rejected inside completeSignIn against the pending record's state.
				guard let result = await makeWebAuthFlow(session: session).complete(url) else { return }
				if case .failure(let error) = result {
					authErrorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
				}
			}
		}
	}
}
