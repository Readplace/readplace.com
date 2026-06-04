import SafariServices
import SwiftUI

/// Opens a URL in an in-app Safari view. (The original article URL is opened
/// here; the server's authenticated reader at `/queue/{id}/view` needs a cookie
/// session this token-based POC doesn't hold.)
struct SafariView: UIViewControllerRepresentable {
	let url: URL

	func makeUIViewController(context: Context) -> SFSafariViewController {
		SFSafariViewController(url: url)
	}

	func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
