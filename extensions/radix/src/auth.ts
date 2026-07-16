import { OAuth, open } from "@vicinae/api";
import { createHash, randomBytes } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
	AUTHORIZATION_ENDPOINT,
	RADIX_AUTH_SCOPE,
	RADIX_CLIENT_ID,
	TOKEN_ENDPOINT,
} from "./config";

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

const oauthClient = new OAuth.PKCEClient({
	providerName: "Radix",
	providerId: "radix",
	providerIcon: "extension_icon.png",
	redirectMethod: OAuth.RedirectMethod.Web,
	description: "Connect to Radix",
});

export class AuthenticationRequiredError extends Error {
	constructor(message = "Sign in to Radix to continue") {
		super(message);
		this.name = "AuthenticationRequiredError";
	}
}

export const getStoredTokens = () => oauthClient.getTokens();

export const signOutFromRadix = () => oauthClient.removeTokens();

export const signInToRadix = async () => {
	const authRequest = createAuthorizationRequest();
	const { authorizationCode, redirectUri } = await receiveAuthorizationCode(
		authRequest.state,
		async (callbackRedirectUri) => {
			await open(createAuthorizationUrl(authRequest, callbackRedirectUri));
		},
	);

	const tokenResponse = await exchangeAuthorizationCode({
		authorizationCode,
		codeVerifier: authRequest.codeVerifier,
		redirectUri,
	});

	await oauthClient.setTokens(tokenResponse);
	return tokenResponse;
};

export const getValidAccessToken = async () => {
	const tokenSet = await oauthClient.getTokens();

	if (!tokenSet?.accessToken) {
		throw new AuthenticationRequiredError();
	}

	if (!tokenSet.isExpired()) {
		return tokenSet.accessToken;
	}

	if (!tokenSet.refreshToken) {
		await oauthClient.removeTokens();
		throw new AuthenticationRequiredError(
			"Radix session expired. Sign in again.",
		);
	}

	const refreshedTokens = await refreshTokens(tokenSet.refreshToken);
	await oauthClient.setTokens(refreshedTokens);

	return refreshedTokens.access_token;
};

type AuthorizationRequest = {
	codeChallenge: string;
	codeVerifier: string;
	state: string;
};

const createAuthorizationRequest = (): AuthorizationRequest => {
	const codeVerifier = base64Url(randomBytes(32));
	const codeChallenge = base64Url(
		createHash("sha256").update(codeVerifier).digest(),
	);
	const state = base64Url(randomBytes(32));

	return { codeChallenge, codeVerifier, state };
};

const createAuthorizationUrl = (
	request: AuthorizationRequest,
	redirectUri: string,
) => {
	const params = new URLSearchParams({
		client_id: RADIX_CLIENT_ID,
		code_challenge: request.codeChallenge,
		code_challenge_method: "S256",
		redirect_uri: redirectUri,
		response_mode: "query",
		response_type: "code",
		scope: RADIX_AUTH_SCOPE,
		state: request.state,
	});

	return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
};

const receiveAuthorizationCode = (
	expectedState: string,
	onReady: (redirectUri: string) => Promise<void>,
): Promise<{ authorizationCode: string; redirectUri: string }> => {
	return new Promise((resolve, reject) => {
		let redirectUri = "";
		let settled = false;

		const server = createServer(
			(request: IncomingMessage, response: ServerResponse) => {
				if (!redirectUri) {
					sendCallbackResponse(
						response,
						false,
						"Radix sign-in is not ready yet.",
					);
					return;
				}

				const callbackUrl = new URL(request.url ?? "/", redirectUri);

				if (callbackUrl.pathname !== "/") {
					sendCallbackResponse(
						response,
						false,
						"Unsupported Radix callback path.",
					);
					return;
				}

				const error = callbackUrl.searchParams.get("error");
				if (error) {
					const errorDescription =
						callbackUrl.searchParams.get("error_description") ?? error;
					sendCallbackResponse(response, false, errorDescription);
					fail(new Error(errorDescription));
					return;
				}

				const authorizationCode = callbackUrl.searchParams.get("code");
				const returnedState = callbackUrl.searchParams.get("state");

				if (!authorizationCode) {
					sendCallbackResponse(response, false, "Missing authorization code.");
					fail(new Error("Radix sign-in callback did not include a code."));
					return;
				}

				if (returnedState !== expectedState) {
					sendCallbackResponse(response, false, "Invalid authorization state.");
					fail(new Error("Radix sign-in callback state did not match."));
					return;
				}

				sendCallbackResponse(response, true, "Radix sign-in completed.");
				finish({ authorizationCode, redirectUri });
			},
		);

		const timeout = setTimeout(() => {
			fail(new Error("Timed out waiting for Radix sign-in callback."));
		}, CALLBACK_TIMEOUT_MS);

		const cleanup = () => {
			clearTimeout(timeout);
			server.close();
		};

		const finish = (result: {
			authorizationCode: string;
			redirectUri: string;
		}) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(result);
		};

		const fail = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};

		server.on("error", fail);

		server.listen(0, "localhost", () => {
			const address = server.address();

			if (!address || typeof address === "string") {
				fail(new Error("Could not start Radix sign-in callback server."));
				return;
			}

			redirectUri = `http://localhost:${(address as AddressInfo).port}`;
			onReady(redirectUri).catch(fail);
		});
	});
};

const exchangeAuthorizationCode = async ({
	authorizationCode,
	codeVerifier,
	redirectUri,
}: {
	authorizationCode: string;
	codeVerifier: string;
	redirectUri: string;
}) => {
	const params = new URLSearchParams({
		client_id: RADIX_CLIENT_ID,
		code: authorizationCode,
		code_verifier: codeVerifier,
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
		scope: RADIX_AUTH_SCOPE,
	});

	return postTokenRequest(
		params,
		"Failed to exchange Radix authorization code.",
	);
};

const refreshTokens = async (refreshToken: string) => {
	const params = new URLSearchParams({
		client_id: RADIX_CLIENT_ID,
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		scope: RADIX_AUTH_SCOPE,
	});

	const tokenResponse = await postTokenRequest(
		params,
		"Failed to refresh Radix access token.",
	);
	tokenResponse.refresh_token = tokenResponse.refresh_token ?? refreshToken;
	return tokenResponse;
};

const postTokenRequest = async (
	params: URLSearchParams,
	failureMessage: string,
): Promise<OAuth.TokenResponse> => {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params,
	});

	if (!response.ok) {
		throw new Error(`${failureMessage} ${await response.text()}`.trim());
	}

	const tokenResponse = (await response.json()) as OAuth.TokenResponse;

	if (!tokenResponse.access_token) {
		throw new Error("Radix token response did not include an access token.");
	}

	return tokenResponse;
};

const base64Url = (buffer: Buffer) => {
	return buffer
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
};

const sendCallbackResponse = (
	response: ServerResponse,
	success: boolean,
	message: string,
) => {
	response.writeHead(success ? 200 : 400, {
		"Content-Type": "text/html; charset=utf-8",
	});
	response.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Radix Sign-In</title>
<style>
body { font-family: system-ui, sans-serif; margin: 3rem; line-height: 1.5; color: #1f2937; }
main { max-width: 34rem; }
</style>
</head>
<body>
<main>
<h1>${success ? "Radix sign-in completed" : "Radix sign-in failed"}</h1>
<p>${escapeHtml(message)}</p>
<p>You can close this browser tab and return to Vicinae.</p>
</main>
</body>
</html>`);
};

const escapeHtml = (value: string) => {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
};
