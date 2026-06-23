import SwiftUI

struct LoginView: View {
	@EnvironmentObject private var session: AppSession
	/// Owned by `RootView`, which handles the `readplace://oauth-callback` deep
	/// link, so a failed external-browser Sign up can surface here while this
	/// view is still on screen.
	@Binding var signupErrorText: String?
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

				VStack(spacing: 14) {
					Button {
						errorText = nil
						signupErrorText = nil
						showingAuth = true
					} label: {
						Text("Login")
							.font(.headline)
							.frame(maxWidth: .infinity)
							.padding(.vertical, 14)
					}
					.buttonStyle(.borderedProminent)

					Button {
						startSignup()
					} label: {
						Text("Don't have an account? Sign up")
							.font(.footnote)
					}
					.buttonStyle(.plain)
					.foregroundStyle(.tint)
				}

				if let errorText {
					Text(errorText)
						.font(.footnote)
						.foregroundStyle(.red)
						.multilineTextAlignment(.center)
				}

				if let signupErrorText {
					Text(signupErrorText)
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

	/// Opens `/oauth/authorize` in the external browser (Chrome if installed, to
	/// reuse its session). A fresh `start()` overwrites any prior pending record,
	/// so an abandoned earlier attempt can't strand stale secrets. The result
	/// arrives later via the `readplace://oauth-callback` deep link (`RootView`).
	@MainActor
	private func startSignup() {
		errorText = nil
		signupErrorText = nil
		makeSignupFlow(session: session).start()
	}
}
