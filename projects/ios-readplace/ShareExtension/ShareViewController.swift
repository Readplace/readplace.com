import UIKit

/// The share-sheet entry point. Renders the shared page in a WKWebView (or
/// takes a shared PDF's bytes straight from the payload, or fetches them),
/// uploads the captured content via the `save-content` action — degrading to a
/// URL-only save if the token is missing, capture fails, or the content is too
/// big.
@MainActor
final class ShareViewController: UIViewController {
	private let store = TokenStore()

	private let card = UIView()
	private let iconView = UIImageView()
	private let spinner = UIActivityIndicatorView(style: .large)
	private let statusLabel = UILabel()

	override func viewDidLoad() {
		super.viewDidLoad()
		setupUI()
		Task { await run() }
	}

	private func run() async {
		setStatus("Saving…")
		let shared = await ShareURLExtractor.extract(from: extensionContext)

		let captor = LazyHTMLCaptor { [weak self] webView in self?.attachHidden(webView) }
		let saver = SaveSharedPage(store: store, api: ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store), captor: captor)
		let sharedPdf: (() async -> Data?)? = shared?.pdfProvider.map { provider in
			{ await ShareURLExtractor.loadPDFData(provider) }
		}
		switch await saver.run(url: shared?.url, fallbackTitle: shared?.title, sharedPdf: sharedPdf) {
		case .savedWithContent:
			finish(message: "Saved with content", symbol: "checkmark.circle.fill", tint: .brandSuccess)
		case .savedLinkOnly:
			finish(message: "Saved (link only)", symbol: "checkmark.circle.fill", tint: .brandSuccess)
		case .notLoggedIn:
			finish(message: "Open Readplace and sign in first.",
				symbol: "person.crop.circle.badge.exclamationmark", tint: .brandWarning)
		case .noLink:
			finish(message: "No link found to save.", symbol: "link", tint: .brandWarning)
		case .noSaveAction:
			finish(message: "The server offered no save action.",
				symbol: "exclamationmark.triangle.fill", tint: .brandError)
		case .refused(let messages):
			finish(message: messages.map(\.plainText).joined(separator: "\n"), symbol: "lock.fill",
				tint: messages.contains { $0.kind == .error } ? .brandError : .brandWarning)
		case .failed(let message):
			finish(message: message, symbol: "exclamationmark.triangle.fill", tint: .brandError)
		}
	}

	// MARK: - UI

	private func setupUI() {
		view.backgroundColor = UIColor.black.withAlphaComponent(0.35)

		card.translatesAutoresizingMaskIntoConstraints = false
		card.backgroundColor = .systemBackground
		card.layer.cornerRadius = 16
		view.addSubview(card)

		iconView.translatesAutoresizingMaskIntoConstraints = false
		iconView.contentMode = .scaleAspectFit
		iconView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 40)
		iconView.isHidden = true

		spinner.translatesAutoresizingMaskIntoConstraints = false
		spinner.startAnimating()

		statusLabel.translatesAutoresizingMaskIntoConstraints = false
		statusLabel.text = "Preparing…"
		statusLabel.font = .preferredFont(forTextStyle: .headline)
		statusLabel.textColor = .label
		statusLabel.numberOfLines = 0
		statusLabel.textAlignment = .center

		let stack = UIStackView(arrangedSubviews: [iconView, spinner, statusLabel])
		stack.translatesAutoresizingMaskIntoConstraints = false
		stack.axis = .vertical
		stack.alignment = .center
		stack.spacing = 16
		card.addSubview(stack)

		NSLayoutConstraint.activate([
			card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
			card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
			card.widthAnchor.constraint(equalToConstant: 260),

			stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
			stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -28),
			stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
			stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),

			iconView.heightAnchor.constraint(equalToConstant: 44),
		])
	}

	/// The capture WKWebView must live in the hierarchy to lay out and run JS,
	/// but stays invisible and non-interactive behind the status card.
	private func attachHidden(_ webView: UIView) {
		webView.alpha = 0
		webView.isUserInteractionEnabled = false
		webView.frame = view.bounds
		view.insertSubview(webView, at: 0)
	}

	private func setStatus(_ text: String) {
		statusLabel.text = text
		iconView.isHidden = true
		spinner.startAnimating()
	}

	private func finish(message: String, symbol: String, tint: UIColor) {
		spinner.stopAnimating()
		spinner.isHidden = true
		iconView.image = UIImage(systemName: symbol)
		iconView.tintColor = tint
		iconView.isHidden = false
		statusLabel.text = message

		DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
			self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
		}
	}
}

/// Builds the capture web view only when a capture is actually requested. A share
/// extension runs under a tight memory budget, so the logged-out / no-link guards
/// in `SaveSharedPage.run` must short-circuit before any WKWebView is allocated.
@MainActor
private final class LazyHTMLCaptor: HTMLCapturing {
	private let attach: (UIView) -> Void
	private var captor: HTMLCaptor?

	init(attach: @escaping (UIView) -> Void) {
		self.attach = attach
	}

	func capture(url: URL) async -> CapturedPage {
		let captor = HTMLCaptor()
		self.captor = captor
		attach(captor.webView)
		let capturing: HTMLCapturing = captor
		return await capturing.capture(url: url)
	}
}
