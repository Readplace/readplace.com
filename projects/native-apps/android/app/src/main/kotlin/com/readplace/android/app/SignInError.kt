package com.readplace.android.app

fun signInErrorText(outcome: Result<Unit>?): String? =
	outcome?.exceptionOrNull()?.let { failure -> failure.message ?: COULD_NOT_SIGN_IN }

private const val COULD_NOT_SIGN_IN = "Couldn't sign in. Try again."
