import SwiftUI

struct LoginView: View {
	@EnvironmentObject private var session: AppSession
	@State private var baseURLField = ""
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

				VStack(alignment: .leading, spacing: 6) {
					Text("Server")
						.font(.caption)
						.foregroundStyle(.secondary)
					TextField("https://readplace.com", text: $baseURLField)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
						.keyboardType(.URL)
						.padding(12)
						.background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
				}

				Button {
					session.setBaseURL(baseURLField)
					errorText = nil
					showingAuth = true
				} label: {
					Text("Sign in")
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
			.onAppear { baseURLField = session.baseURL }
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
