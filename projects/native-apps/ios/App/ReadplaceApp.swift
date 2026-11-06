import SwiftUI
import UIKit

@main
struct ReadplaceApp: App {
	@UIApplicationDelegateAdaptor(BackgroundSessionAppDelegate.self) private var backgroundSessions
	@StateObject private var session = ReadplaceApp.makeSession()

	private static func makeSession() -> AppSession {
		let store = TokenStore()
		let configuration = readlistCachingConfiguration()
		let recovery = NativeRefreshRecovery(endpoints: AppConfig.serverEndpoints, records: store.authRecords,
			configuration: configuration, surface: .app, version: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown")
		Task { await recovery.record(.contextStarted); await recovery.flush() }
		return AppSession(store: store, nativeUserAgent: processNativeUserAgent(), sessionConfiguration: configuration, recovery: recovery)
	}

	var body: some Scene {
		WindowGroup {
			RootView(launchedLoggedIn: session.isLoggedIn)
				.environmentObject(session)
		}
	}

	private static func readlistCachingConfiguration() -> URLSessionConfiguration {
		let group = TokenStore.resolvedAppGroupId
		guard let container = AppGroupContainer.entitled(appGroupId: group) else {
			preconditionFailure("App Group \(group) is required for the reading list's offline copy")
		}
		return ReadlistHTTPCache.configuration(in: container)
	}
}

struct RootView: View {
	@EnvironmentObject private var session: AppSession
	@State private var authErrorText: String?
	@Environment(\.scenePhase) private var scenePhase
	@StateObject private var intro: LaunchIntroModel
	@StateObject private var sloganRotation = SloganRotation(
		fallback: AppConfig.fallbackSlogan,
		seed: UInt64.random(in: .min ... .max),
		intervalNanoseconds: 12_000_000_000,
		startedAt: Date()
	)

	init(launchedLoggedIn: Bool) {
		_intro = StateObject(wrappedValue: makeLaunchIntroModel(reduceMotion: UIAccessibility.isReduceMotionEnabled, isLoggedIn: launchedLoggedIn))
	}

	var body: some View {
		Group {
			if session.isLoggedIn {
				ReadingListView(session: session, onSignedOut: { intro.replay() })
			} else {
				LoginView(
					session: session,
					authErrorText: $authErrorText,
					makeFlow: makeWebAuthFlow(session:),
					slogans: session.makeSloganSource(),
					intro: intro,
					rotation: sloganRotation
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
