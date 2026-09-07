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
	private let titleGroup = UIStackView()
	private let backdropTap = UITapGestureRecognizer()
	private let hold = ShareSheetHold(holdSeconds: 3)

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
		let group = TokenStore.resolvedAppGroupId
		guard let defaults = UserDefaults(suiteName: group) else {
			preconditionFailure("App Group \(group) is required to read the share target")
		}
		let containerURL = FileManager.default.containerURL(
			forSecurityApplicationGroupIdentifier: group
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
			unseenSave: containerURL.map(UnseenSave.init(containerURL:)),
			shareTarget: ShareTarget(defaults: defaults),
			readlistChooser: self
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
		await hold.untilSettledAndRead(settled)
		extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
	}

	@objc private func backdropTapped() {
		hold.end()
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
		titleGroup.addArrangedSubview(statusLabel)
		titleGroup.addArrangedSubview(noticeLabel)
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
		spinner.isHidden = false
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
		backdropTap.isEnabled = true

		switch outcome {
		case .saved, .savedAwaitingUpload: haptics.notificationOccurred(.success)
		default: break
		}
	}
}

extension ShareViewController: ReadlistChoosing {
	func choose(among readlists: [Readlist]) async -> Set<Readlist> {
		spinner.stopAnimating()
		spinner.isHidden = true
		statusLabel.text = "Save to which readlists?"
		noticeLabel.text = "You can change this later in the Readplace app"
		noticeLabel.isHidden = false

		let choices = UIStackView()
		choices.translatesAutoresizingMaskIntoConstraints = false
		choices.axis = .vertical
		choices.alignment = .fill
		choices.spacing = 8

		return await withCheckedContinuation { (continuation: CheckedContinuation<Set<Readlist>, Never>) in
			var ticks: [UIButton] = []
			for readlist in readlists {
				let button = UIButton(configuration: Self.tickConfiguration(title: readlist.label, isTicked: false))
				button.addAction(
					UIAction { [weak button] _ in
						guard let button else { return }
						button.isSelected.toggle()
						button.configuration = Self.tickConfiguration(title: readlist.label, isTicked: button.isSelected)
					},
					for: .touchUpInside
				)
				ticks.append(button)
				choices.addArrangedSubview(button)
			}
			let done = UIButton(configuration: Self.doneConfiguration())
			done.addAction(
				UIAction { [weak self] _ in
					choices.removeFromSuperview()
					self?.setStatus("Saving…")
					continuation.resume(returning: Set(zip(readlists, ticks).filter { $0.1.isSelected }.map(\.0)))
				},
				for: .touchUpInside
			)
			choices.addArrangedSubview(done)
			titleGroup.insertArrangedSubview(choices, at: 1)
		}
	}

	private static func tickConfiguration(title: String, isTicked: Bool) -> UIButton.Configuration {
		var configuration = isTicked ? UIButton.Configuration.filled() : UIButton.Configuration.tinted()
		configuration.title = title
		configuration.image = UIImage(systemName: isTicked ? "checkmark.square.fill" : "square")
		configuration.imagePadding = 8
		configuration.baseBackgroundColor = BrandColor.amber
		configuration.cornerStyle = .medium
		return configuration
	}

	private static func doneConfiguration() -> UIButton.Configuration {
		var configuration = UIButton.Configuration.filled()
		configuration.title = "Done"
		configuration.baseBackgroundColor = BrandColor.amber
		configuration.cornerStyle = .medium
		return configuration
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
