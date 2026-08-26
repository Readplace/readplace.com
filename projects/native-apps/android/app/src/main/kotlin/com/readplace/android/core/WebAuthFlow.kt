package com.readplace.android.core

import java.io.IOException
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/**
 * What the in-app auth presentation returned: the `readplace://oauth-callback` URL
 * it captured, the user dismissing it, or a presentation that never ran. A
 * dismissal is a choice rather than a fault, so it is its own case here and never
 * becomes an error the sign-in screen shows.
 */
sealed interface WebAuthPresentation {
	data class Returned(val callbackUrl: String) : WebAuthPresentation

	data object Dismissed : WebAuthPresentation

	data class Failure(val message: String) : WebAuthPresentation
}

sealed class AuthFlowError(message: String) : Exception(message) {
	class Denied(val reason: String) : AuthFlowError("Authorization was denied ($reason).")

	class MissingCode : AuthFlowError("No authorization code was returned.")

	class StateMismatch : AuthFlowError("Security check failed (state mismatch).")

	/** Carries the presenter's own account of why the sign-in page never opened. */
	class PresentationFailed(message: String) : AuthFlowError(message) {
		companion object {
			/** The account a presenter gives when it has none more specific. */
			const val SIGN_IN_PAGE_DID_NOT_OPEN =
				"Could not open the sign-in page. Please try again."
		}
	}
}

/**
 * The UI-free core of the in-app auth flow, shared by Login and Sign up, which
 * differ only in the authorize request handed to [start]. One suspension spans
 * the whole attempt because the auth presentation hands the callback back to its
 * caller instead of routing it through the app's URL handler — so the PKCE
 * verifier lives in this call's scope and never reaches disk.
 */
fun interface WebAuthFlow {
	/** `null` when the user dismissed the auth presentation. */
	suspend fun start(request: AuthorizationRequest): Result<Unit>?
}

/**
 * Partial application (`init*`) wiring the injected seams into a [WebAuthFlow]:
 * how to show the authorize URL and capture the callback it redirects to, and the
 * OAuth client that exchanges the code that comes back — injected so tests never
 * present a browser.
 */
fun initWebAuthFlow(
	present: suspend (authorizeUrl: String) -> WebAuthPresentation,
	oauth: OAuth,
): WebAuthFlow =
	WebAuthFlow { request -> outcomeOf(present(request.url), request, oauth) }

private suspend fun outcomeOf(
	presentation: WebAuthPresentation,
	request: AuthorizationRequest,
	oauth: OAuth,
): Result<Unit>? =
	when (presentation) {
		is WebAuthPresentation.Failure ->
			Result.failure(AuthFlowError.PresentationFailed(presentation.message))
		WebAuthPresentation.Dismissed -> null
		is WebAuthPresentation.Returned -> completeSignIn(presentation.callbackUrl, request, oauth)
	}

/**
 * Completes sign-in: validate the callback, then exchange the code for tokens.
 *
 * The request's `redirectUri` must equal the one the authorize request used — the
 * OAuth server checks it by exact string at token time.
 */
private suspend fun completeSignIn(
	callbackUrl: String,
	request: AuthorizationRequest,
	oauth: OAuth,
): Result<Unit> {
	val items = queryItemsOf(callbackUrl)
	fun value(name: String): String? = items.firstOrNull { it.first == name }?.second

	val denial = value("error")
	if (denial != null) return Result.failure(AuthFlowError.Denied(denial))
	val code = value("code") ?: return Result.failure(AuthFlowError.MissingCode())
	if (value("state") != request.state) return Result.failure(AuthFlowError.StateMismatch())

	return try {
		oauth.exchangeCode(
			code = code,
			verifier = request.codeVerifier,
			redirectUri = request.redirectUri,
		)
		Result.success(Unit)
	} catch (error: Exception) {
		// A catch-all like the iOS original: persisting the minted tokens can fail
		// in the Keystore, and that must reach the sign-in screen as a failure.
		Result.failure(error)
	}
}

/**
 * The callback's query items in order, a bare name carrying no value. A callback
 * that is not a URI at all — Android hands the redirect over as a lenient `Uri`,
 * where iOS's `URL` had already refused it — has no items, and so reads as one
 * carrying no code.
 */
private fun queryItemsOf(callbackUrl: String): List<Pair<String, String?>> {
	val rawQuery = rawQueryOf(callbackUrl) ?: return emptyList()
	return rawQuery.split("&").map { item ->
		val name = item.substringBefore("=")
		val value = if (item.contains("=")) item.substringAfter("=") else null
		decoded(name) to value?.let(::decoded)
	}
}

private fun rawQueryOf(url: String): String? =
	try {
		URI(url).rawQuery
	} catch (_: URISyntaxException) {
		null
	}

/** Percent-decoding only: a query `+` is a literal plus, as Foundation's
 * `URLComponents` reads it, not the space that form decoding would make of it. */
private fun decoded(encoded: String): String = URLDecoder.decode(encoded.replace("+", "%2B"), "UTF-8")
