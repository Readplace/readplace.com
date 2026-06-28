import SwiftUI

/// The reader sheet's content. It opens immediately on tap and shows a skeleton
/// of the article while the cookie session is minted from the bearer, then swaps
/// in the authenticated web view. If the bootstrap fails it shows a standard
/// "couldn't open" view rather than a blank page. Splitting the wait out of the
/// tap keeps tapping a row instantly responsive, like following a link.
struct ReaderSheet: View {
	let presentation: ReaderPresentation
	let mintSession: () async -> HTTPCookie?
	let onMarkedRead: () -> Void
	let onClose: () -> Void

	@State private var cookie: HTTPCookie?
	@State private var bootstrapFailed = false

	var body: some View {
		Group {
			if let cookie {
				ReaderWebView(url: presentation.readerURL, cookie: cookie, onMarkedRead: onMarkedRead)
			} else if bootstrapFailed {
				ReaderUnavailableView(onClose: onClose)
			} else {
				ReaderSkeletonView()
			}
		}
		.tint(.brandAmber)
		.task {
			guard cookie == nil, !bootstrapFailed else { return }
			if let minted = await mintSession() {
				cookie = minted
			} else {
				bootstrapFailed = true
			}
		}
	}
}

/// A static placeholder that previews the reader's shape (title, byline, body
/// lines) while it loads. Skeletons keep a tapped row feeling responsive without
/// the content-free spin of a `ProgressView`, mirroring the web's loading skeleton.
private struct ReaderSkeletonView: View {
	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			bar(nil, 30)
			bar(160, 16)
			VStack(alignment: .leading, spacing: 10) {
				ForEach(0..<7, id: \.self) { _ in bar(nil, 12) }
				bar(200, 12)
			}
			.padding(.top, 10)
			Spacer()
		}
		.padding(24)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityElement()
		.accessibilityLabel("Opening reader")
	}

	private func bar(_ width: CGFloat?, _ height: CGFloat) -> some View {
		RoundedRectangle(cornerRadius: 6)
			.fill(Color(.secondarySystemBackground))
			.frame(maxWidth: width ?? .infinity, alignment: .leading)
			.frame(height: height)
	}
}

/// The standard view shown when the reader can't be opened (the session couldn't
/// be minted, or the server returned nothing the client can show). Gives the user
/// a way out instead of a blank sheet.
private struct ReaderUnavailableView: View {
	let onClose: () -> Void

	var body: some View {
		VStack(spacing: 12) {
			Image(systemName: "wifi.slash")
				.font(.system(size: 40))
				.foregroundStyle(.secondary)
			Text("Couldn't open the reader")
				.font(.headline)
			Text("Check your connection and try again.")
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
			Button("Close", action: onClose)
				.buttonStyle(.borderedProminent)
				.padding(.top, 4)
		}
		.padding(40)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}
}
