import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";

/** Only fills a variable that is missing or blank — `.env` ships empty OAuth
 * placeholders, and an empty string still fails validation. */
const fallback = (key: string, value: string) => {
	if (!process.env[key]) {
		process.env[key] = value;
	}
};

// `ConfigModule.forRoot()` validates the environment while `AppModule` is being
// evaluated, so these have to land before that module is imported — hence the
// dynamic import below. Real values win; these only keep the suite runnable
// somewhere without credentials, such as CI.
fallback(
	"DATABASE_URL",
	"postgresql://postgres:postgres@localhost:5432/crm?schema=public",
);
fallback("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long");
fallback("API_URL", "http://localhost:3001");
fallback("ALLOWED_SIGN_IN", "example.com");
fallback("GOOGLE_CLIENT_ID", "test-google-client-id");
fallback("GOOGLE_CLIENT_SECRET", "test-google-client-secret");

describe("Auth (e2e)", () => {
	let app: INestApplication;

	// Booting the whole application is not a five-second operation, and five
	// seconds is what `bun test` allows a hook by default. Compiling `AppModule`
	// stands up Prisma, Better Auth and the tRPC router factory — nine routers
	// and thirty-nine procedures — and on a cold cache that lands either side of
	// the limit: this file failed two runs in five, always here, reported as
	// `(unnamed)` with a hook timeout because the hook is not a test and has no
	// name to print. The suite that passed took seven seconds to do the same
	// work, so the boot was never wrong, only unbudgeted.
	beforeAll(async () => {
		const { AppModule } = await import("../src/app.module");

		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();

		app = moduleFixture.createNestApplication({ bodyParser: false });
		await app.init();
	}, 60_000);

	afterAll(async () => {
		await app.close();
	});

	it("rejects an unauthenticated request to a guarded route", async () => {
		await request(app.getHttpServer()).get("/auth/me").expect(401);
	});

	it("allows an unauthenticated request to an optional-auth route", async () => {
		const response = await request(app.getHttpServer())
			.get("/auth/session")
			.expect(200);

		expect(response.body).toEqual({ authenticated: false, user: null });
	});

	// Asserting the route is mounted rather than that it succeeds: Better Auth
	// stores rate limits in the database, so a 200 here needs a live Postgres.
	it("mounts the Better Auth handler", async () => {
		const response = await request(app.getHttpServer()).get("/api/auth/ok");

		expect(response.status).not.toBe(404);
	});
});
