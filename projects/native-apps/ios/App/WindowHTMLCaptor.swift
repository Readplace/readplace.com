import SwiftUI
import UIKit
import WebKit

@MainActor
final class CaptureAnchor {
	fileprivate var host: UIView?

	func attachHidden(_ webView: UIView) {
		guard let window = host?.window else { return }
		webView.alpha = 0
		webView.isUserInteractionEnabled = false
		webView.frame = window.bounds
		window.insertSubview(webView, at: 0)
	}
}

struct CaptureAnchorView: UIViewRepresentable {
	let anchor: CaptureAnchor

	func makeUIView(context: Context) -> UIView {
		let view = UIView(frame: .zero)
		view.isUserInteractionEnabled = false
		anchor.host = view
		return view
	}

	func updateUIView(_ uiView: UIView, context: Context) {}
}

@MainActor
struct WindowHTMLCaptor: HTMLCapturing {
	let anchor: CaptureAnchor

	func capture(url: URL) async -> CapturedPage {
		let captor = HTMLCaptor()
		anchor.attachHidden(captor.webView)
		defer { captor.webView.removeFromSuperview() }
		let capturing: HTMLCapturing = captor
		return await capturing.capture(url: url)
	}
}

@MainActor
struct WindowReaderPrefetcher: ReaderPrefetching {
	let anchor: CaptureAnchor

	private static let timeout: TimeInterval = 12
	private static let diskWriteNanoseconds: UInt64 = 1_500_000_000

	func prefetch(request: URLRequest, cookies: [HTTPCookie]) async -> Bool {
		let captor = HTMLCaptor()
		anchor.attachHidden(captor.webView)
		defer { captor.webView.removeFromSuperview() }
		let cookieStore = captor.webView.configuration.websiteDataStore.httpCookieStore
		for cookie in cookies {
			await cookieStore.setCookie(cookie)
		}
		guard !Task.isCancelled else { return false }
		_ = await withTaskCancellationHandler {
			await captor.capture(request: request, timeout: Self.timeout)
		} onCancel: {
			Task { @MainActor in await captor.cancel() }
		}
		guard !Task.isCancelled,
			ReaderPrefetch.wasStored(mainFrameStatus: captor.mainFrameStatus, mainDocumentLoaded: captor.mainDocumentLoaded)
		else { return false }
		_ = try? await captor.webView.callAsyncJavaScript(
			Self.loadLazyImages,
			arguments: ["timeoutMs": Self.timeout * 1000],
			in: nil,
			contentWorld: .page
		)
		return true
	}

	func waitUntilStored() async {
		try? await Task.sleep(nanoseconds: Self.diskWriteNanoseconds)
	}

	private static let loadLazyImages = """
		const lazy = Array.from(document.querySelectorAll('img[loading="lazy"]'));
		lazy.forEach((image) => { image.loading = 'eager'; });
		await Promise.race([
			Promise.all(lazy.map((image) => image.complete ? null : new Promise((resolve) => {
				image.addEventListener('load', resolve, { once: true });
				image.addEventListener('error', resolve, { once: true });
			}))),
			new Promise((resolve) => setTimeout(resolve, timeoutMs)),
		]);
		return lazy.length;
		"""
}
