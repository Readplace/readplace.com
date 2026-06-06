package com.readplace.poc.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import com.readplace.poc.R

/** Sign-in screen: the server is editable (defaults to readplace.com) before launching OAuth. */
@Composable
fun LoginScreen(
	baseUrl: String,
	onBaseUrlChange: (String) -> Unit,
	onSignIn: () -> Unit,
) {
	Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
		Column(
			modifier = Modifier
				.fillMaxSize()
				.padding(32.dp),
			horizontalAlignment = Alignment.CenterHorizontally,
			verticalArrangement = Arrangement.Center,
		) {
			Image(
				painter = painterResource(R.mipmap.ic_launcher_foreground),
				contentDescription = null,
				contentScale = ContentScale.Fit,
				modifier = Modifier.size(96.dp),
			)
			Text(
				text = "Readplace",
				style = MaterialTheme.typography.headlineMedium,
				color = MaterialTheme.colorScheme.primary,
				modifier = Modifier.padding(top = 12.dp),
			)
			Text(
				text = "Where reading still matters.",
				style = MaterialTheme.typography.bodyMedium,
				color = MaterialTheme.colorScheme.onBackground,
				modifier = Modifier.padding(top = 4.dp, bottom = 32.dp),
			)

			OutlinedTextField(
				value = baseUrl,
				onValueChange = onBaseUrlChange,
				label = { Text("Server") },
				singleLine = true,
				keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
				modifier = Modifier.fillMaxWidth(),
			)

			Button(
				onClick = onSignIn,
				shape = RoundedCornerShape(12.dp),
				modifier = Modifier
					.padding(top = 24.dp)
					.fillMaxWidth(),
			) {
				Text("Sign in")
			}
		}
	}
}
