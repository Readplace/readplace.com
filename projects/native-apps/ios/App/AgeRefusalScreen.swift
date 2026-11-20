import SwiftUI
import UIKit

struct AgeRefusalMessage: View {
	let text: String

	var body: some View {
		VStack(spacing: 16) {
			Image(systemName: "lock.fill")
				.font(.system(size: 36, weight: .regular))
				.foregroundColor(.brandAmber)
				.accessibilityHidden(true)
			Text(text)
				.font(.title3)
				.multilineTextAlignment(.center)
				.foregroundColor(Color(uiColor: BrandColor.textPrimary))
				.fixedSize(horizontal: false, vertical: true)
		}
	}
}

@MainActor
final class AgeRefusalScreen {
	let controller = UIViewController()
	private let message: UIHostingController<AgeRefusalMessage>

	var messageView: UIView { message.view }

	init(text: String) {
		message = UIHostingController(rootView: AgeRefusalMessage(text: text))
		let root: UIView = controller.view
		root.backgroundColor = BrandColor.surface
		message.view.backgroundColor = .clear
		message.view.translatesAutoresizingMaskIntoConstraints = false
		controller.addChild(message)
		root.addSubview(message.view)
		message.didMove(toParent: controller)

		let margins = root.layoutMarginsGuide
		let preferredWidth = message.view.widthAnchor.constraint(equalToConstant: 480)
		preferredWidth.priority = .defaultHigh
		NSLayoutConstraint.activate([
			message.view.centerXAnchor.constraint(equalTo: margins.centerXAnchor),
			message.view.centerYAnchor.constraint(equalTo: margins.centerYAnchor),
			message.view.leadingAnchor.constraint(greaterThanOrEqualTo: margins.leadingAnchor, constant: 16),
			message.view.trailingAnchor.constraint(lessThanOrEqualTo: margins.trailingAnchor, constant: -16),
			preferredWidth,
		])
	}

	func show(text: String) {
		message.rootView = AgeRefusalMessage(text: text)
	}
}

struct AgeRefusalView: UIViewControllerRepresentable {
	let text: String

	func makeCoordinator() -> AgeRefusalScreen {
		AgeRefusalScreen(text: text)
	}

	func makeUIViewController(context: Context) -> UIViewController {
		context.coordinator.controller
	}

	func updateUIViewController(_ controller: UIViewController, context: Context) {
		context.coordinator.show(text: text)
	}
}
