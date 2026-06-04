import UIKit

/// The share-sheet entry point. Renders the shared page in a WKWebView,
/// captures its HTML, and saves it via the `save-html` action — degrading to a
/// URL-only save if the token is missing, capture fails, or the HTML is too big.
@MainActor
final class ShareViewController: UIViewController {
	/// Mirrors the server's `MAX_RAW_HTML_BYTES` (10 MiB). Above this the server
	/// would reject the payload, so we skip straight to the URL-only path.
	private static let maxRawHTMLBytes = 10 * 1024 * 1024

	private let store = TokenStore()
	private var captor: HTMLCaptor?

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
		NSLog("[ReadplacePOC] ShareExt start: group=\(TokenStore.resolvedAppGroupId) loggedIn=\(store.isLoggedIn) baseURL=\(store.baseURL)")
		guard store.isLoggedIn else {
			NSLog("[ReadplacePOC] ShareExt: no token visible in the App Group — not logged in")
			finish(message: "Open Readplace and sign in first.",
				symbol: "person.crop.circle.badge.exclamationmark", success: false)
			return
		}
		guard let shared = await ShareURLExtractor.extract(from: extensionContext) else {
			finish(message: "No link found to save.", symbol: "link", success: false)
			return
		}
		NSLog("[ReadplacePOC] ShareExt: extracted url=\(shared.url.absoluteString)")

		setStatus("Rendering page…")
		let captor = HTMLCaptor()
		self.captor = captor
		attachHidden(captor.webView)
		let captured = await captor.capture(url: shared.url)
		let title = (captured.title?.isEmpty == false) ? captured.title : shared.title

		setStatus("Saving…")
		let api = ReadplaceAPI(baseURL: store.baseURL, store: store)
		do {
			let page = try await api.loadQueue()
			let urlString = shared.url.absoluteString

			if let html = captured.rawHtml, html.utf8.count <= Self.maxRawHTMLBytes,
				let action = page.saveHtmlAction {
				_ = try await api.saveHTML(action: action, url: urlString, rawHtml: html, title: title)
				finish(message: "Saved with content", symbol: "checkmark.circle.fill", success: true)
			} else if let action = page.saveArticleAction {
				_ = try await api.saveArticle(action: action, url: urlString)
				finish(message: "Saved (link only)", symbol: "checkmark.circle.fill", success: true)
			} else {
				finish(message: "The server offered no save action.",
					symbol: "exclamationmark.triangle.fill", success: false)
			}
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? "Save failed."
			finish(message: message, symbol: "exclamationmark.triangle.fill", success: false)
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

	private func finish(message: String, symbol: String, success: Bool) {
		spinner.stopAnimating()
		spinner.isHidden = true
		iconView.image = UIImage(systemName: symbol)
		iconView.tintColor = success ? .systemGreen : .systemOrange
		iconView.isHidden = false
		statusLabel.text = message

		DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
			self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
		}
	}
}
