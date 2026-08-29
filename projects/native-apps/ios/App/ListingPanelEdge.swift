import SwiftUI
import UIKit

struct ListingPanelEdge: Equatable {
	static let cornerRadius: CGFloat = 12
	static let borderWidth: CGFloat = 1
	static let gutter: CGFloat = 16

	let isFirst: Bool
	let isLast: Bool

	init(of article: Article, in articles: [Article]) {
		isFirst = articles.first?.id == article.id
		isLast = articles.last?.id == article.id
	}

	var roundedCorners: UIRectCorner {
		var corners: UIRectCorner = []
		if isFirst { corners.formUnion([.topLeft, .topRight]) }
		if isLast { corners.formUnion([.bottomLeft, .bottomRight]) }
		return corners
	}

	var borderInsets: EdgeInsets {
		EdgeInsets(
			top: Self.borderWidth,
			leading: Self.borderWidth,
			bottom: isLast ? Self.borderWidth : 0,
			trailing: Self.borderWidth
		)
	}

	var rowInsets: EdgeInsets {
		EdgeInsets(
			top: isFirst ? Self.gutter : 0,
			leading: Self.gutter,
			bottom: isLast ? Self.gutter : 0,
			trailing: Self.gutter
		)
	}

	var borderShape: ListingPanelShape {
		ListingPanelShape(corners: roundedCorners, radius: Self.cornerRadius)
	}

	var fillShape: ListingPanelShape {
		ListingPanelShape(corners: roundedCorners, radius: Self.cornerRadius - Self.borderWidth)
	}
}

struct ListingPanelShape: Shape, Equatable {
	let corners: UIRectCorner
	let radius: CGFloat

	func path(in rect: CGRect) -> Path {
		Path(
			UIBezierPath(
				roundedRect: rect,
				byRoundingCorners: corners,
				cornerRadii: CGSize(width: radius, height: radius)
			).cgPath
		)
	}
}
