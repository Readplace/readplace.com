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

	var body: some View {
		if session.isLoggedIn {
			ReadingListView(session: session)
		} else {
			LoginView()
		}
	}
}
