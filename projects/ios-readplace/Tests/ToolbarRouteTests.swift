import XCTest
@testable import Readplace

/// The toolbar maps each advertised control to a side effect without gating which
/// controls exist: a navigable link opens, the `save-article` action prompts for a
/// URL (the sanctioned bespoke handler), and any other action is invoked through the
/// generic invoker — never opened as a GET web view of its href.
final class ToolbarRouteTests: XCTestCase {
	private func action(name: String, href: String? = "/queue", title: String? = nil) -> SirenAction {
		SirenAction(name: name, href: href, method: "POST", title: title, type: nil, fields: nil)
	}

	func testNavigableLinkRoutesToOpen() {
		let link = SirenLink(rel: ["save"], href: "/save", title: "Save a link")
		let affordance = try! XCTUnwrap(Affordance(link: link))

		XCTAssertEqual(ToolbarRoute.route(for: affordance), .open(link))
	}

	func testSaveArticleActionRoutesToTheNativeSaveDialog() {
		let save = action(name: "save-article")
		let affordance = try! XCTUnwrap(Affordance(action: save))

		XCTAssertEqual(ToolbarRoute.route(for: affordance), .promptSave(save))
	}

	func testNonSaveActionRoutesToTheGenericInvoker() {
		// A bare-invokable collection action is submitted through the generic invoker,
		// honouring its own method/type/fields — never opened as a GET web view of its
		// href, which would discard the action's invocation and silently turn a
		// capability into navigation.
		let purge = action(name: "purge-all", href: "/queue/purge", title: "Purge")
		let affordance = try! XCTUnwrap(Affordance(action: purge))

		XCTAssertEqual(ToolbarRoute.route(for: affordance), .invoke(purge))
	}
}
