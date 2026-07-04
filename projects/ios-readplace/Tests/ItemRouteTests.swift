import XCTest
@testable import Readplace

/// The row maps each advertised item control to a side effect purely, so a
/// link-only control opens (rather than being dropped) and a destructive control
/// routes through a confirmation before invoking — decided here, not by a per-name
/// check in the view.
final class ItemRouteTests: XCTestCase {
	private func action(name: String, href: String? = "/queue/a1/status", title: String? = nil) -> SirenAction {
		SirenAction(name: name, href: href, method: "POST", title: title, type: nil, fields: nil)
	}

	func testNavigableLinkRoutesToOpen() {
		let link = SirenLink(rel: ["share"], href: "/queue/a1/share", title: "Share")
		let affordance = try! XCTUnwrap(Affordance(link: link))

		XCTAssertEqual(ItemRoute.route(for: affordance), .open(link))
	}

	func testDestructiveActionRoutesToConfirmation() {
		// `delete` is destructive per the presentation mapping, so it must confirm
		// before invoking rather than acting on the tap.
		let delete = action(name: "delete", href: "/queue/a1/delete", title: "Delete")
		let affordance = try! XCTUnwrap(Affordance(action: delete))

		XCTAssertEqual(ItemRoute.route(for: affordance), .confirmDestructive(delete))
	}

	func testNonDestructiveActionRoutesToInvoke() {
		let markRead = action(name: "update-status", title: "Mark as read")
		let affordance = try! XCTUnwrap(Affordance(action: markRead))

		XCTAssertEqual(ItemRoute.route(for: affordance), .invoke(markRead))
	}
}
