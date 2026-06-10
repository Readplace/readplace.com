import UIKit

/// The share-sheet entry point. Renders the shared page in a WKWebView,
/// captures its HTML, and saves it via the `save-html` action — degrading to a
/// URL-only save if the token is missing, capture fails, or the HTML is too big.
@MainActor
final class ShareViewController: UIViewController {
	private let store = TokenStore()

	private let card = UIView()
	private let iconView = UIImageView()
	private let spinner = UIActivityIndicatorView(style: .large)
	private let statusLabel = UILabel()
	private let unlockButton = UIButton(type: .system)
	private var lockoutAction: UnlockAction?

	override func viewDidLoad() {
		super.viewDidLoad()
		setupUI()
		Task { await run() }
	}

	private func run() async {
		NSLog("[ReadplacePOC] ShareExt start: group=\(TokenStore.resolvedAppGroupId) loggedIn=\(store.isLoggedIn) baseURL=\(store.baseURL)")

		setStatus("Saving…")
		let shared = await ShareURLExtractor.extract(from: extensionContext)
		if let shared { NSLog("[ReadplacePOC] ShareExt: extracted url=\(shared.url.absoluteString)") }

		let captor = LazyHTMLCaptor { [weak self] webView in self?.attachHidden(webView) }
		let saver = SaveSharedPage(store: store, api: ReadplaceAPI(baseURL: store.baseURL, store: store), captor: captor)
		switch await saver.run(url: shared?.url, fallbackTitle: shared?.title) {
		case .savedWithContent:
			finish(message: "Saved with content", symbol: "checkmark.circle.fill", success: true)
		case .savedLinkOnly:
			finish(message: "Saved (link only)", symbol: "checkmark.circle.fill", success: true)
		case .notLoggedIn:
			NSLog("[ReadplacePOC] ShareExt: no token visible in the App Group — not logged in")
			finish(message: "Open Readplace and sign in first.",
				symbol: "person.crop.circle.badge.exclamationmark", success: false)
		case .noLink:
			finish(message: "No link found to save.", symbol: "link", success: false)
		case .noSaveAction:
			finish(message: "The server offered no save action.",
				symbol: "exclamationmark.triangle.fill", success: false)
		case .accountLocked(let message, let action):
			finishLocked(message: message, action: action)
		case .failed(let message):
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

		unlockButton.translatesAutoresizingMaskIntoConstraints = false
		unlockButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
		unlockButton.isHidden = true
		unlockButton.addTarget(self, action: #selector(unlockTapped), for: .touchUpInside)

		let stack = UIStackView(arrangedSubviews: [iconView, spinner, statusLabel, unlockButton])
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

	/// Locked account: show the server's message and a button pointing at the
	/// unlock destination, and do NOT auto-dismiss — the save was refused and the
	/// user needs to read it and choose to act.
	private func finishLocked(message: String, action: UnlockAction) {
		spinner.stopAnimating()
		spinner.isHidden = true
		iconView.image = UIImage(systemName: "lock.fill")
		iconView.tintColor = .systemOrange
		iconView.isHidden = false
		statusLabel.text = message
		lockoutAction = action
		unlockButton.setTitle(action.title, for: .normal)
		unlockButton.isHidden = false
	}

	@objc private func unlockTapped() {
		guard let action = lockoutAction, let url = URL(string: action.href) else { return }
		extensionContext?.open(url) { [weak self] _ in
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
