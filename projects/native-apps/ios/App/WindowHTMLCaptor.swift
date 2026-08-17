import SwiftUI
import UIKit

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
