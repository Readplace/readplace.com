import UIKit

@MainActor
final class ShareViewController: UIViewController {
	private let store = TokenStore()
	private let haptics = UINotificationFeedbackGenerator()

	private let card = UIView()
	private let iconView = UIImageView()
	private let spinner = UIActivityIndicatorView(style: .large)
	private let statusLabel = UILabel()
	private let noticeLabel = UILabel()
	/// Tapping outside the card dismisses. Disabled until the server has confirmed
	/// the save, because until then a dismissal would abandon a save in flight.
	private let backdropTap = UITapGestureRecognizer()
	/// Called by the backdrop tap to end the sheet's wait early; nil until the
	/// wait is running.
	private var dismissNow: (() -> Void)?

	override func viewDidLoad() {
		super.viewDidLoad()
		setupUI()
		Task { await run() }
	}

	private func run() async {
		setStatus("Saving…")
		haptics.prepare()
		let shared = await ShareURLExtractor.extract(from: extensionContext)

		let captor = LazyHTMLCaptor { [weak self] webView in self?.attachHidden(webView) }
		let containerURL = FileManager.default.containerURL(
			forSecurityApplicationGroupIdentifier: TokenStore.resolvedAppGroupId
		)
		let saver = SaveSharedPage(
			store: store,
			api: ReadplaceAPI(
				baseURL: AppConfig.serverBaseURL,
				store: store,
				sessionConfiguration: DiscoveryHTTPCache.configuration(containerURL: containerURL)
			),
			captor: captor,
			jobs: containerURL.map(UploadJobStore.init(containerURL:)),
			unseenSave: containerURL.map(UnseenSave.init(containerURL:))
		)
		let sharedPdf: (() async -> Data?)? = shared?.pdfProvider.map { provider in
			{ await ShareURLExtractor.loadPDFData(provider) }
		}
		let settled = Task { [weak self] in
			let outcome = await saver.run(
				url: shared?.url,
				fallbackTitle: shared?.title,
				sharedPdf: sharedPdf,
				onNotice: { [weak self] messages in
					guard let self, !messages.isEmpty else { return }
					self.noticeLabel.text = messages.map(\.plainText).joined(separator: "\n")
					self.noticeLabel.isHidden = false
				},
				onSaved: { [weak self] _ in
					// The server has answered and the link is on it, so leaving now
					// costs nothing the reader was promised.
					self?.backdropTap.isEnabled = true
				},
				onStillSaving: { [weak self] in
					guard let self, !self.spinner.isHidden else { return }
					self.setStatus("Still saving…")
				}
			)
			self?.paint(outcome)
		}
		await endOfSheet(settled)
		extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
	}

	/// Returns once the journey has settled, or as soon as the reader taps outside
	/// the card — whichever lands first.
	private func endOfSheet(_ settled: Task<Void, Never>) async {
		let claim = FirstClaim()
		await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
			dismissNow = { if claim.take() { continuation.resume() } }
			Task { @MainActor in
				await settled.value
				if claim.take() { continuation.resume() }
			}
		}
	}

	@objc private func backdropTapped() {
		dismissNow?()
	}

	private func uiColor(for tone: ShareStatusTone) -> UIColor {
		switch tone {
		case .success: return .brandSuccess
		case .warning: return .brandWarning
		case .error: return .brandError
		}
	}

	// MARK: - UI

	private func setupUI() {
		view.backgroundColor = UIColor.black.withAlphaComponent(0.35)

		backdropTap.addTarget(self, action: #selector(backdropTapped))
		backdropTap.delegate = self
		backdropTap.isEnabled = false
		view.addGestureRecognizer(backdropTap)

		card.translatesAutoresizingMaskIntoConstraints = false
		card.backgroundColor = .brandSurface
		card.layer.cornerRadius = 16
		view.addSubview(card)

		iconView.translatesAutoresizingMaskIntoConstraints = false
		iconView.contentMode = .scaleAspectFit
		iconView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 40)
		iconView.isHidden = true

		spinner.translatesAutoresizingMaskIntoConstraints = false
		spinner.startAnimating()
		spinner.color = .brandTextSecondary

		statusLabel.translatesAutoresizingMaskIntoConstraints = false
		statusLabel.text = "Preparing…"
		statusLabel.font = .preferredFont(forTextStyle: .headline)
		statusLabel.textColor = .brandTextPrimary
		statusLabel.numberOfLines = 0
		statusLabel.textAlignment = .center

		noticeLabel.translatesAutoresizingMaskIntoConstraints = false
		noticeLabel.font = .preferredFont(forTextStyle: .footnote)
		noticeLabel.textColor = .brandTextSecondary
		noticeLabel.numberOfLines = 0
		noticeLabel.textAlignment = .center
		noticeLabel.isHidden = true

		// The title and its caption sit as a tight pair (a 4pt gap), set apart from
		// the icon and spinner by the main stack's larger spacing.
		let titleGroup = UIStackView(arrangedSubviews: [statusLabel, noticeLabel])
		titleGroup.translatesAutoresizingMaskIntoConstraints = false
		titleGroup.axis = .vertical
		titleGroup.alignment = .center
		titleGroup.spacing = 4

		let stack = UIStackView(arrangedSubviews: [iconView, spinner, titleGroup])
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

	private func paint(_ outcome: SaveSharedOutcome) {
		let status = ShareStatusPresentation(outcome: outcome)
		spinner.stopAnimating()
		spinner.isHidden = true
		iconView.image = UIImage(systemName: status.symbol)
		iconView.tintColor = uiColor(for: status.tone)
		iconView.isHidden = false
		statusLabel.text = status.message
		noticeLabel.text = status.subtitle
		noticeLabel.isHidden = status.subtitle == nil

		switch outcome {
		case .saved, .savedAwaitingUpload: haptics.notificationOccurred(.success)
		default: break
		}
	}
}

/// The card is the sheet's content, not its backdrop: a tap that lands on it is
/// not a request to leave.
extension ShareViewController: UIGestureRecognizerDelegate {
	func gestureRecognizer(
		_ gestureRecognizer: UIGestureRecognizer,
		shouldReceive touch: UITouch
	) -> Bool {
		!card.frame.contains(touch.location(in: view))
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
