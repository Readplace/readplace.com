package com.readplace.poc.core

/**
 * Central configuration for the Readplace Android POC.
 *
 * The app reuses the existing public OAuth/PKCE client registered on the server
 * (`hutch-chrome-extension`) and its registered HTTPS callback URL, so it talks
 * to production exactly like the browser extension does — no server-side changes
 * are required. See the server's
 * `src/packages/test-fixtures/src/providers/oauth/oauth-clients.ts`.
 */
object AppConfig {
	/** Default server. Overridable at runtime on the sign-in screen and persisted so the share target targets the same server. */
	const val DEFAULT_BASE_URL = "https://readplace.com"

	/**
	 * A registered public PKCE client. `https://readplace.com/oauth/callback` is
	 * one of its allow-listed redirect URIs, which is what makes the in-app
	 * WebView interception strategy work without a server change.
	 */
	const val CLIENT_ID = "hutch-chrome-extension"

	/** The Siren hypermedia media type the API speaks. */
	const val SIREN_MEDIA_TYPE = "application/vnd.siren+json"

	/** Path appended to the base URL to form the registered redirect URI. */
	const val CALLBACK_PATH = "/oauth/callback"

	/**
	 * Mirrors the server's `MAX_RAW_HTML_BYTES`. Above this the server rejects the
	 * payload, so the share target skips straight to the URL-only save path.
	 */
	const val MAX_RAW_HTML_BYTES = 10 * 1024 * 1024

	/**
	 * A Chrome-like user agent. Embedded WebViews are sometimes refused by Google's
	 * sign-in ("disallowed_useragent"); presenting a stock mobile-Chrome UA reduces
	 * that. Email/password sign-in works regardless.
	 */
	const val WEB_VIEW_USER_AGENT =
		"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
			"Chrome/120.0.0.0 Mobile Safari/537.36"
}
