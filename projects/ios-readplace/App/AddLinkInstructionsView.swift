import SwiftUI

/// The sheet shown when the user taps + on the reading list. Rather than an
/// in-app paste box (removed), it teaches adding links through the iOS Share
/// menu by rendering the server's `GET /help/add-links` page in a webview, so
/// the copy ships via a hutch deploy rather than an App Store release. The help
/// URL is discovered from the queue's Siren links; when it is missing (the queue
/// hasn't loaded, or the link wasn't advertised) or the page fails to load, the
/// sheet shows a local fallback that still teaches Share rather than a blank or
/// dead-end page.
struct AddLinkInstructionsView: View {
	let helpURL: URL?
	let onClose: () -> Void

	@State private var isLoading = true
	@State private var loadFailed = false

	var body: some View {
		NavigationStack {
			content
				.navigationTitle("Add a link")
				.navigationBarTitleDisplayMode(.inline)
				.toolbar {
					ToolbarItem(placement: .navigationBarLeading) {
						Button("Back to Queue", action: onClose)
					}
				}
		}
	}

	@ViewBuilder
	private var content: some View {
		if let helpURL, !loadFailed {
			ZStack {
				WebPageView(
					url: helpURL,
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
	/// degrades gracefully; "Back to Queue" lives in the toolbar above.
	private var fallback: some View {
		VStack(spacing: 12) {
			Image(systemName: "square.and.arrow.up")
				.font(.system(size: 40))
				.foregroundStyle(.secondary)
			Text("Add links with Share")
				.font(.headline)
			Text("Open a link in any app, tap Share, then choose Readplace.")
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
		}
		.padding(40)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}
}
