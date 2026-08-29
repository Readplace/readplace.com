import XCTest
import SwiftUI
import UIKit
@testable import Readplace

final class ListingPanelEdgeTests: XCTestCase {
	private func article(id: String) -> Article {
		Article(
			id: id,
			url: "https://example.com/\(id)",
			title: "A Title",
			siteName: "Example",
			excerpt: "An excerpt.",
			imageURL: nil,
			readTimeLabel: "~6 min read",
			isRead: false,
			savedAt: nil,
			actions: [],
			links: [],
			readHref: nil
		)
	}

	func testTheFirstRowRoundsItsTopCornersAndOpensDownward() {
		let articles = [article(id: "a1"), article(id: "a2"), article(id: "a3")]
		let edge = ListingPanelEdge(of: articles[0], in: articles)

		XCTAssertTrue(edge.isFirst)
		XCTAssertFalse(edge.isLast)
		XCTAssertEqual(edge.roundedCorners, [.topLeft, .topRight])
		XCTAssertEqual(edge.borderInsets, EdgeInsets(top: 1, leading: 1, bottom: 0, trailing: 1))
		XCTAssertEqual(edge.rowInsets, EdgeInsets(top: 16, leading: 16, bottom: 0, trailing: 16))
	}

	func testAMiddleRowIsSquareWithAHairlineAboveAndNoBorderBelow() {
		let articles = [article(id: "a1"), article(id: "a2"), article(id: "a3")]
		let edge = ListingPanelEdge(of: articles[1], in: articles)

		XCTAssertFalse(edge.isFirst)
		XCTAssertFalse(edge.isLast)
		XCTAssertEqual(edge.roundedCorners, [])
		XCTAssertEqual(edge.borderInsets, EdgeInsets(top: 1, leading: 1, bottom: 0, trailing: 1))
		XCTAssertEqual(edge.rowInsets, EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
	}

	func testTheLastRowRoundsItsBottomCornersAndClosesThePanel() {
		let articles = [article(id: "a1"), article(id: "a2"), article(id: "a3")]
		let edge = ListingPanelEdge(of: articles[2], in: articles)

		XCTAssertFalse(edge.isFirst)
		XCTAssertTrue(edge.isLast)
		XCTAssertEqual(edge.roundedCorners, [.bottomLeft, .bottomRight])
		XCTAssertEqual(edge.borderInsets, EdgeInsets(top: 1, leading: 1, bottom: 1, trailing: 1))
		XCTAssertEqual(edge.rowInsets, EdgeInsets(top: 0, leading: 16, bottom: 16, trailing: 16))
	}

	func testASingleRowIsTheWholePanel() {
		let articles = [article(id: "a1")]
		let edge = ListingPanelEdge(of: articles[0], in: articles)

		XCTAssertTrue(edge.isFirst)
		XCTAssertTrue(edge.isLast)
		XCTAssertEqual(edge.roundedCorners, [.topLeft, .topRight, .bottomLeft, .bottomRight])
		XCTAssertEqual(edge.borderInsets, EdgeInsets(top: 1, leading: 1, bottom: 1, trailing: 1))
		XCTAssertEqual(edge.rowInsets, EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16))
	}

	func testTheFillShapeSitsOneBorderWidthInsideTheBorderShape() {
		let articles = [article(id: "a1"), article(id: "a2"), article(id: "a3")]
		let edge = ListingPanelEdge(of: articles[0], in: articles)

		XCTAssertEqual(edge.borderShape.radius, 12)
		XCTAssertEqual(edge.fillShape, ListingPanelShape(corners: [.topLeft, .topRight], radius: 11))
	}

	func testTheBorderShapeRoundsOnlyTheRequestedCorners() {
		let rect = CGRect(x: 0, y: 0, width: 200, height: 80)
		let path = ListingPanelShape(corners: [.topLeft, .topRight], radius: 12).path(in: rect)

		XCTAssertEqual(path.boundingRect, rect)
		XCTAssertFalse(path.contains(CGPoint(x: 1, y: 1)))
		XCTAssertTrue(path.contains(CGPoint(x: 1, y: 79)))
	}

	func testASquareShapeContainsEveryCorner() {
		let rect = CGRect(x: 0, y: 0, width: 200, height: 80)
		let path = ListingPanelShape(corners: [], radius: 12).path(in: rect)

		XCTAssertTrue(path.contains(CGPoint(x: 1, y: 1)))
		XCTAssertTrue(path.contains(CGPoint(x: 199, y: 79)))
	}
}
