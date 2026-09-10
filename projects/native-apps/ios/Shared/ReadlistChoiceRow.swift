import SwiftUI

struct ReadlistChoiceRow: View {
	let drop: SharedArticlesDrop

	var body: some View {
		HStack(spacing: 10) {
			Image(systemName: SharedArticlesDropPresentation.boxSystemImage(for: drop))
				.font(.system(size: 18, weight: .regular))
				.foregroundStyle(SharedArticlesDropPresentation.boxTint(for: drop))
			Text(drop.label)
				.font(.footnote)
				.foregroundStyle(SharedArticlesDropPresentation.titleTint(for: drop))
				.multilineTextAlignment(.leading)
				.fixedSize(horizontal: false, vertical: true)
			Spacer(minLength: 0)
			if let lock = SharedArticlesDropPresentation.lockSystemImage(for: drop) {
				Image(systemName: lock)
					.font(.system(size: 12, weight: .regular))
					.foregroundStyle(SharedArticlesDropPresentation.titleTint(for: drop))
			}
		}
		.padding(.horizontal, 12)
		.padding(.vertical, 10)
		.frame(minHeight: 44)
		.background(
			RoundedRectangle(cornerRadius: 10, style: .continuous)
				.fill(Color.brandSurfaceSubtle)
		)
		.overlay(
			RoundedRectangle(cornerRadius: 10, style: .continuous)
				.stroke(
					SharedArticlesDropPresentation.boxTint(for: drop)
						.opacity(SharedArticlesDropPresentation.borderOpacity(for: drop)),
					lineWidth: 1
				)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel(drop.label)
		.accessibilityAddTraits(SharedArticlesDropPresentation.accessibilityTraits(for: drop))
	}
}
