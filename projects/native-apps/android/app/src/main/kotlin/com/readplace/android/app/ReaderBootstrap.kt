package com.readplace.android.app

import okhttp3.Cookie

sealed interface ReaderSessionMint {
	data class Minted(val cookies: List<Cookie>) : ReaderSessionMint

	data object Failed : ReaderSessionMint

	data object Superseded : ReaderSessionMint
}

sealed interface ReaderBootstrap {
	data object Loading : ReaderBootstrap

	data class Ready(val cookies: List<Cookie>) : ReaderBootstrap

	data object Unavailable : ReaderBootstrap

	companion object {
		fun after(mint: ReaderSessionMint): ReaderBootstrap =
			when (mint) {
				is ReaderSessionMint.Minted -> Ready(mint.cookies)
				ReaderSessionMint.Failed -> Unavailable
				ReaderSessionMint.Superseded -> Loading
			}
	}
}
