import SwiftUI
import UIKit

@MainActor
final class ReadlistChoiceCard {
	private static let title = "Where do shared articles drop?"
	private static let caption = "Tick none and I'll drop them in your main readlist."
	private static let doneTitle = "Done"
	private static let touchTargetFloor = 44.0

	let view = UIView()
	let card = UIView()
	let list = UIStackView()
	let scroll = UIScrollView()
	let done = UIButton(type: .custom)

	private let onDone: (Set<Readlist>) -> Void
	private var hosts: [UIHostingController<ReadlistChoiceRow>] = []
	private var choices: [(readlist: Readlist, row: Int)] = []
	private var ticked: Set<Readlist> = []

	init(drops: [SharedArticlesDrop], onDone: @escaping (Set<Readlist>) -> Void) {
		self.onDone = onDone
		buildCard()
		for drop in drops {
			addRow(drop)
		}
	}

	var rows: [UIView] { list.arrangedSubviews }

	private func buildCard() {
		card.translatesAutoresizingMaskIntoConstraints = false
		card.backgroundColor = .brandSurface
		card.layer.cornerRadius = 16
		view.addSubview(card)

		let heading = UILabel()
		heading.text = Self.title
		heading.font = .preferredFont(forTextStyle: .headline)
		heading.textColor = .brandTextPrimary
		heading.numberOfLines = 0
		heading.textAlignment = .center

		let note = UILabel()
		note.text = Self.caption
		note.font = .preferredFont(forTextStyle: .footnote)
		note.textColor = .brandTextSecondary
		note.numberOfLines = 0
		note.textAlignment = .center

		let titleGroup = UIStackView(arrangedSubviews: [heading, note])
		titleGroup.axis = .vertical
		titleGroup.alignment = .fill
		titleGroup.spacing = 4

		list.axis = .vertical
		list.alignment = .fill
		list.spacing = 8
		list.translatesAutoresizingMaskIntoConstraints = false

		scroll.translatesAutoresizingMaskIntoConstraints = false
		scroll.addSubview(list)
		scroll.setContentCompressionResistancePriority(.defaultLow, for: .vertical)

		var configuration = UIButton.Configuration.filled()
		configuration.title = Self.doneTitle
		configuration.baseBackgroundColor = BrandColor.amber
		configuration.baseForegroundColor = .white
		configuration.cornerStyle = .medium
		configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 24, bottom: 12, trailing: 24)
		done.configuration = configuration
		done.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)

		let content = UIStackView(arrangedSubviews: [titleGroup, scroll, done])
		content.translatesAutoresizingMaskIntoConstraints = false
		content.axis = .vertical
		content.alignment = .fill
		content.spacing = 16
		card.addSubview(content)

		let preferredWidth = card.widthAnchor.constraint(equalToConstant: 340)
		preferredWidth.priority = .defaultHigh
		let listHug = scroll.heightAnchor.constraint(equalTo: list.heightAnchor)
		listHug.priority = .defaultLow

		let safe = view.safeAreaLayoutGuide
		NSLayoutConstraint.activate([
			card.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
			card.centerYAnchor.constraint(equalTo: safe.centerYAnchor),
			card.leadingAnchor.constraint(greaterThanOrEqualTo: safe.leadingAnchor, constant: 16),
			card.trailingAnchor.constraint(lessThanOrEqualTo: safe.trailingAnchor, constant: -16),
			card.topAnchor.constraint(greaterThanOrEqualTo: safe.topAnchor, constant: 16),
			card.bottomAnchor.constraint(lessThanOrEqualTo: safe.bottomAnchor, constant: -16),
			preferredWidth,
			done.heightAnchor.constraint(greaterThanOrEqualToConstant: Self.touchTargetFloor),

			content.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
			content.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -24),
			content.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
			content.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),

			list.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
			list.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
			list.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
			list.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
			list.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
			listHug,
		])
	}

	private func addRow(_ drop: SharedArticlesDrop) {
		let host = UIHostingController(rootView: ReadlistChoiceRow(drop: drop))
		host.sizingOptions = [.intrinsicContentSize]
		host.view.backgroundColor = .clear
		host.view.isUserInteractionEnabled = false
		host.view.translatesAutoresizingMaskIntoConstraints = false

		let button = UIButton(type: .custom)
		button.addSubview(host.view)
		NSLayoutConstraint.activate([
			host.view.topAnchor.constraint(equalTo: button.topAnchor),
			host.view.bottomAnchor.constraint(equalTo: button.bottomAnchor),
			host.view.leadingAnchor.constraint(equalTo: button.leadingAnchor),
			host.view.trailingAnchor.constraint(equalTo: button.trailingAnchor),
		])

		button.accessibilityLabel = drop.label
		button.isSelected = drop.showsTick

		hosts.append(host)
		list.addArrangedSubview(button)

		guard let readlist = drop.choice else { return }
		button.tag = choices.count
		button.addTarget(self, action: #selector(rowTapped), for: .touchUpInside)
		choices.append((readlist: readlist, row: hosts.count - 1))
	}

	@objc private func rowTapped(_ sender: UIButton) {
		let choice = choices[sender.tag]
		ticked.formSymmetricDifference([choice.readlist])
		let drop: SharedArticlesDrop = ticked.contains(choice.readlist)
			? .ticked(choice.readlist)
			: .unticked(choice.readlist)
		sender.isSelected = drop.showsTick
		hosts[choice.row].rootView = ReadlistChoiceRow(drop: drop)
	}

	@objc private func doneTapped() {
		onDone(ticked)
	}
}
