package com.readplace.android.core

class ServerEndpoints(val origin: String) {
	val authorize = "$origin/oauth/authorize"
	val token = "$origin/oauth/token"
	val revoke = "$origin/oauth/revoke"
	val authorizationServerMetadata = "$origin/.well-known/oauth-authorization-server"
	val authDiagnostics = "$origin/diagnostics/auth"
}
