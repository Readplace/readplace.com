import SwiftUI
import UIKit

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
	@Environment(\.scenePhase) private var scenePhase
	@StateObject private var intro = makeLaunchIntroModel(reduceMotion: UIAccessibility.isReduceMotionEnabled)

	var body: some View {
		Group {
			if session.isLoggedIn {
				ReadingListView(session: session)
			} else {
				LoginView(session: session, authErrorText: $authErrorText, makeFlow: makeWebAuthFlow(session:), intro: intro)
			}
		}
		.tint(.brandAmber)
		.overlay(LaunchIntroOverlayView(model: intro))
		.onChange(of: session.isLoggedIn) { isLoggedIn in
			intro.sync(isLoggedIn: isLoggedIn, isForeground: scenePhase == .active)
		}
		.onChange(of: scenePhase) { phase in
			intro.sync(isLoggedIn: session.isLoggedIn, isForeground: phase == .active)
		}
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
