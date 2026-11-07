import Foundation

struct SavedArticle: Decodable {
	struct Properties: Decodable {
		let url: String
	}

	let `class`: [String]
	let properties: Properties
}

private struct SaveArticleBody: Encodable {
	let url: String
	let readlists: [String]?
}

func saveArticle(collection: ReadplaceCollection, origin: URL, token: String, url: String, readlists: [String]? = nil, session: URLSession = .shared) async throws -> SavedArticle {
	guard let action = collection.actions.first(where: { $0.name == "save-article" }) else {
		throw ReadplaceAPIError.missingAction("save-article")
	}
	guard let target = URL(string: action.href, relativeTo: origin) else {
		throw ReadplaceAPIError.unresolvableURL(action.href)
	}
	var request = sirenRequest(url: target, token: token)
	request.httpMethod = action.method
	request.setValue(action.type ?? "application/json", forHTTPHeaderField: "Content-Type")
	request.setValue("return=representation", forHTTPHeaderField: "Prefer")
	request.httpBody = try JSONEncoder().encode(SaveArticleBody(url: url, readlists: readlists))
	let (data, response) = try await session.data(for: request, delegate: HeadersPreservingRedirects())
	guard let http = response as? HTTPURLResponse, http.statusCode == 201 else {
		throw ReadplaceAPIError.unexpectedStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
	}
	return try JSONDecoder().decode(SavedArticle.self, from: data)
}
