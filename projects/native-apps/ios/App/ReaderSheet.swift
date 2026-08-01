import SwiftUI

/// The reader sheet's content. It opens immediately on tap and shows a skeleton
/// of the article while the cookie session is minted from the bearer, then swaps
/// in the authenticated web view. If the bootstrap fails it shows a standard
/// "couldn't open" view rather than a blank page. Splitting the wait out of the
/// tap keeps tapping a row instantly responsive, like following a link.
struct ReaderSheet: View {
	let presentation: ReaderPresentation
	let mintSession: () async -> ReaderSessionMint
	let onMarkedRead: () -> Void
	let onCaptureBlocked: (HTMLCapturing) async -> Void
	let onClose: () -> Void
	let onLogout: () -> Void

	@State private var bootstrap = ReaderBootstrap.loading
	@State private var loadPhase: ReaderLoadPhase = .loading

	var body: some View {
		Group {
			switch bootstrap {
			case .ready(let cookies):
				reader(cookies: cookies)
			case .unavailable:
				ReaderUnavailableView(onClose: onClose)
			case .loading:
				ReaderSkeletonView()
			}
		}
		.tint(.brandAmber)
		.task {
			guard case .loading = bootstrap else { return }
			bootstrap = ReaderBootstrap(after: await mintSession())
		}
	}

	/// The web view with its loading chrome layered over it: the skeleton keeps
	/// covering the page from the tap through the real page load (not just the
	/// session mint), lifting the moment content paints, while a thin progress bar
	/// tracks the web view's actual `estimatedProgress`. The web view alone ignores
	/// the safe area so the article paints edge-to-edge while the bar stays clear of
	/// the status bar.
	@ViewBuilder
	private func reader(cookies: [HTTPCookie]) -> some View {
		let overlay = ReaderLoad.overlay(for: loadPhase)
		ZStack(alignment: .top) {
			ReaderWebView(
				url: presentation.readerURL,
				cookies: cookies,
				onMarkedRead: onMarkedRead,
				onCaptureBlocked: onCaptureBlocked,
				onClose: onClose,
				onLogout: onLogout,
				externalBrowser: .system,
				onLoadPhaseChange: { loadPhase = $0 }
			)
			.ignoresSafeArea()

			if loadPhase == .failed {
				ReaderUnavailableView(onClose: onClose)
					.transition(.opacity)
			}
			if overlay.showsSkeleton {
				ReaderSkeletonView()
					.transition(.opacity)
			}
			if overlay.showsProgressBar {
				ReaderLoadingBar(progress: overlay.progress)
					.transition(.opacity)
			}
		}
		.animation(.easeOut(duration: 0.3), value: overlay.showsSkeleton)
		.animation(.easeOut(duration: 0.35), value: overlay.showsProgressBar)
		.animation(.easeOut(duration: 0.3), value: loadPhase == .failed)
	}
}

/// A slim determinate bar pinned to the top of the reader, filled to the web
/// view's real `estimatedProgress` so a slow article shows measurable movement
/// instead of a blank wait. The native linear `ProgressView` owns its own fill, so
/// it starts empty and grows from the left — no first-frame flash to full width
/// that a custom `GeometryReader` fill inherits from the sheet's present animation.
/// Amber (via the sheet tint) because it is chrome; the reading surface stays
/// neutral. Hidden from accessibility — the skeleton already announces the load.
private struct ReaderLoadingBar: View {
	let progress: Double

	var body: some View {
		ProgressView(value: min(max(progress, 0), 1))
			.progressViewStyle(.linear)
			.accessibilityHidden(true)
	}
}

/// A placeholder that previews the reader's shape (title, byline, body lines)
/// while it loads. A gradient sweep signals ongoing work without the content-free
/// spin of a `ProgressView`, mirroring the web's loading skeleton; the sweep is
/// dropped under Reduce Motion, leaving the static gray shape. The neutral fill
/// keeps the reading surface free of brand colour — the amber lives in the bar.
private struct ReaderSkeletonView: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var sweep = false

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
		.background(Color(.systemBackground))
		.onAppear { sweep = true }
		.accessibilityElement()
		.accessibilityLabel("Opening reader")
	}

	private func bar(_ width: CGFloat?, _ height: CGFloat) -> some View {
		RoundedRectangle(cornerRadius: 6)
			.fill(Color(.secondarySystemBackground))
			.frame(maxWidth: width ?? .infinity, alignment: .leading)
			.frame(height: height)
			.overlay(shimmer)
			.clipShape(RoundedRectangle(cornerRadius: 6))
	}

	/// A translucent highlight band swept left-to-right across each bar. Removed
	/// entirely (not just paused) under Reduce Motion so no animation is scheduled.
	@ViewBuilder
	private var shimmer: some View {
		if !reduceMotion {
			GeometryReader { geometry in
				let width = geometry.size.width
				LinearGradient(
					colors: [.clear, Color.white.opacity(0.35), .clear],
					startPoint: .leading,
					endPoint: .trailing
				)
				.frame(width: width)
				.offset(x: sweep ? width : -width)
				.animation(.linear(duration: 1.3).repeatForever(autoreverses: false), value: sweep)
			}
		}
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
		// Opaque so that, layered over a failed page load, the broken page does not
		// show through; a no-op against the sheet's own background when shown alone.
		.background(Color(.systemBackground))
	}
}
