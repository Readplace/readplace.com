import Foundation
import StoreKit

struct StorefrontCountryCode: Hashable {
	let raw: String

	static func current() async -> StorefrontCountryCode? {
		await Storefront.current.map { StorefrontCountryCode(raw: $0.countryCode) }
	}

	func cookie(for origin: URL) -> HTTPCookie? {
		HTTPCookie(properties: [
			.name: AppConfig.storefrontCookieName,
			.value: raw,
			.originURL: origin,
			.path: "/",
			.secure: "TRUE",
		])
	}
}

typealias ReadStorefrontCountry = () async -> StorefrontCountryCode?
