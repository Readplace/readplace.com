import SwiftUI

struct LoginView: View {
	@EnvironmentObject private var session: AppSession
	@State private var showingAuth = false
	@State private var errorText: String?

	var body: some View {
		NavigationStack {
			VStack(spacing: 28) {
				Spacer()

				VStack(spacing: 10) {
					Image(systemName: "books.vertical.fill")
						.font(.system(size: 56))
						.foregroundStyle(.tint)
					Text("Readplace")
						.font(.largeTitle.bold())
					Text("Reading-list POC")
						.font(.subheadline)
						.foregroundStyle(.secondary)
				}

				Button {
					errorText = nil
					showingAuth = true
				} label: {
					Text("Login")
						.font(.headline)
						.frame(maxWidth: .infinity)
						.padding(.vertical, 14)
				}
				.buttonStyle(.borderedProminent)

				if let errorText {
					Text(errorText)
						.font(.footnote)
						.foregroundStyle(.red)
						.multilineTextAlignment(.center)
				}

				Spacer()
				Text("Authenticates with OAuth (PKCE) using the same client as the browser extension.")
					.font(.caption2)
					.foregroundStyle(.tertiary)
					.multilineTextAlignment(.center)
			}
			.padding(24)
			.sheet(isPresented: $showingAuth) {
				AuthFlowView { result in
					if case .failure(let error) = result {
						errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
					}
				}
				.environmentObject(session)
			}
		}
	}
}
