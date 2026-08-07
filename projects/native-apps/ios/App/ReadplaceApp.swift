import SwiftUI
import UIKit

@main
struct ReadplaceApp: App {
	@UIApplicationDelegateAdaptor(BackgroundSessionAppDelegate.self) private var backgroundSessions
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
				LoginView(
					session: session,
					authErrorText: $authErrorText,
					makeFlow: makeWebAuthFlow(session:),
					slogans: session.makeSloganSource(),
					intro: intro
				)
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
	}
}
