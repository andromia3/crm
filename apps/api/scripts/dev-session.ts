/**
 * Mints a signed session cookie for a local user.
 *
 * Google is the only sign-in method, which means there is no way to get a
 * session from a script, a test, or a terminal — you need a browser and a real
 * Google account. That is correct for the product and useless for development,
 * so this writes the rows Better Auth would have written and prints the cookie
 * it would have set.
 *
 *   bun run --filter=api dev:session                 # dev@localhost
 *   bun run --filter=api dev:session ada@example.com
 *
 *   curl -H "Cookie: $(bun run --filter=api dev:session)" localhost:3001/auth/me
 *
 * The `account` row is part of that, and it is what makes the cookie work in
 * the *app* rather than only against the API. `requireGoogleAccess()` gates the
 * app shell on the scopes Google actually granted, which it reads from
 * `Account.scope`; with no such row every page redirects to `/grant-access`,
 * and re-consenting is exactly the thing you cannot do without a real OAuth
 * client. Writing the grant here is what lets somebody work on the UI — or read
 * this repo at all — without first creating one in the Google Cloud console.
 *
 * Refuses to run in production: it hands out a valid session for any email.
 */
import { REQUIRED_SCOPES } from "@crm/auth";
import { db } from "@crm/db";

const COOKIE_NAME = "better-auth.session_token";
const SESSION_DAYS = 7;

if (process.env.NODE_ENV === "production") {
	throw new Error(
		"dev-session is a development helper and mints real sessions.",
	);
}

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
	throw new Error("BETTER_AUTH_SECRET is not set — run this from apps/api.");
}

const email = process.argv[2] ?? "dev@localhost";
const name = email.split("@")[0] ?? "Developer";

/** `value.base64(hmacSha256(secret, value))`, url-encoded — Better Auth's format. */
async function signCookieValue(value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value),
	);
	const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
	return encodeURIComponent(`${value}.${base64}`);
}

const user = await db.user.upsert({
	where: { email },
	create: {
		id: `dev-${Buffer.from(email).toString("hex").slice(0, 20)}`,
		email,
		name,
		emailVerified: true,
		updatedAt: new Date(),
	},
	update: {},
});

// Space-separated, which is the form Google returns and Better Auth stores.
// `parseScopes` accepts either, but matching the real thing means this row can
// be read by anything that reads a real one.
const accountId = `dev-account-${user.id}`;

await db.account.upsert({
	where: { id: accountId },
	create: {
		id: accountId,
		accountId: user.id,
		providerId: "google",
		userId: user.id,
		scope: REQUIRED_SCOPES.join(" "),
		updatedAt: new Date(),
	},
	// Re-running is how you repair an account that predates a scope being
	// required, so the grant is refreshed rather than left as it was found.
	update: { scope: REQUIRED_SCOPES.join(" ") },
});

const token = `dev-session-${user.id}`;
const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

await db.session.upsert({
	where: { token },
	create: {
		id: token,
		token,
		userId: user.id,
		expiresAt,
		updatedAt: new Date(),
	},
	update: { expiresAt },
});

console.log(`${COOKIE_NAME}=${await signCookieValue(token)}`);

await db.$disconnect();
