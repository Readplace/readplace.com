import SwiftUI

struct LoginView: View {
	let session: AppSession
	/// Owned by `RootView` (which handles the OAuth deep link) so a failed Login or
	/// Sign up can surface here while this view is still on screen.
	@Binding var authErrorText: String?
	/// Injected so the composition point wires the live browser-opening flow and
	/// tests capture the started request; there is deliberately no internal default.
	let makeFlow: @MainActor (AppSession) -> WebAuthFlow

	var body: some View {
		NavigationStack {
			VStack(spacing: 28) {
				Spacer()

				VStack(spacing: 10) {
					Image("BrandMark")
						.resizable()
						.scaledToFit()
						.frame(width: 72, height: 72)
						.accessibilityHidden(true)
					(Text("Read") + Text("place").foregroundColor(.brandHighlight))
						.font(.largeTitle.bold())
					Text("Read the Web, not the Slop")
						.font(.subheadline)
						.foregroundStyle(.secondary)
				}

				VStack(spacing: 14) {
					Button {
						startLogin()
					} label: {
						Label("Login", systemImage: "rectangle.portrait.and.arrow.right")
							.font(.headline)
							.frame(maxWidth: .infinity)
							.padding(.vertical, 14)
					}
					.buttonStyle(.borderedProminent)

					Button {
						startSignup()
					} label: {
						Label("Sign up", systemImage: "person.badge.plus")
							.font(.headline)
							.frame(maxWidth: .infinity)
							.padding(.vertical, 14)
					}
					.buttonStyle(.bordered)
				}

				if let authErrorText {
					Text(authErrorText)
						.font(.footnote)
						.foregroundStyle(Color.brandError)
						.multilineTextAlignment(.center)
				}

				Spacer()

				Link("Privacy Policy", destination: AppConfig.privacyPolicyURL)
					.font(.footnote)
					.foregroundStyle(.secondary)
			}
			.padding(24)
		}
	}

	/// Opens `/oauth/authorize` for login in the external browser (Chrome if
	/// installed, to reuse its session); the result returns via the deep link.
	@MainActor
	func startLogin() {
		authErrorText = nil
		makeFlow(session).start(session.makeOAuth().makeNativeLoginAuthorizationRequest())
	}

	/// Opens `/oauth/authorize` for sign up in the external browser. A fresh
	/// `start` overwrites any prior pending record so an abandoned attempt can't
	/// strand stale secrets.
	@MainActor
	func startSignup() {
		authErrorText = nil
		makeFlow(session).start(session.makeOAuth().makeSignupAuthorizationRequest())
	}
}
