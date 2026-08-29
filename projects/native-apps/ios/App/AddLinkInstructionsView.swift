import SwiftUI

/// The sheet shown when the user taps + on the reading list. Rather than an
/// in-app paste box (removed), it teaches adding links through the iOS Share
/// menu by rendering the server's help page in a webview, so the copy ships via
/// a hutch deploy rather than an App Store release. The help URL is a client-held
/// path resolved against the API base (`AppConfig.addLinksHelpPath`), not a link
/// discovered from the server.
///
/// Chromeless, like the reader and account sheets: the page renders its own
/// "← Back to queue" deep link, which the webview intercepts to dismiss, so all
/// three in-app sheets return to the native list the same way rather than this
/// one alone wearing a native nav bar. If the URL can't be resolved or the page
/// fails to load, a local fallback still teaches Share — and carries its own
/// native back button, since there is no page to render one.
struct AddLinkInstructionsView: View {
	let helpURL: URL?
	let onClose: () -> Void

	@State private var isLoading = true
	@State private var loadFailed = false

	var body: some View {
		if let helpURL, !loadFailed {
			ZStack {
				WebPageView(
					url: helpURL,
					onClose: onClose,
					onFinish: { isLoading = false },
					onFail: {
						isLoading = false
						loadFailed = true
					}
				)
				if isLoading {
					ProgressView()
				}
			}
		} else {
			fallback
		}
	}

	/// A self-contained native version of the help page, shown when the webview
	/// can't be displayed. It still delivers the core instruction so the feature
	/// degrades gracefully, and — unlike the happy path, whose back link the page
	/// renders — carries its own native "Back to queue" button, mirroring the
	/// reader sheet's native unavailable view.
	private var fallback: some View {
		VStack(spacing: 12) {
			Image(systemName: "square.and.arrow.up")
				.font(.system(size: 40))
				.foregroundStyle(Color.brandTextSecondary)
			Text("Add links with Share")
				.font(.headline)
				.foregroundStyle(Color.brandTextPrimary)
			Text("Open a link in any app, tap Share, then choose Readplace.")
				.font(.subheadline)
				.foregroundStyle(Color.brandTextSecondary)
				.multilineTextAlignment(.center)
			Button("← Back to queue", action: onClose)
				.padding(.top, 4)
		}
		.padding(40)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(Color.brandSurface)
	}
}
