import { describe, expect, it } from "bun:test";
import { formatDay, fromDay, toDay } from "@crm/ui/lib/format";

/**
 * A close date is a day on a calendar, not an instant.
 *
 * This is pinned because the bug it prevents is invisible in the timezone the
 * code was written in and off by a whole day in the one the reps are in: the
 * server stores `2026-12-31` as midnight **UTC**, and anything that reads that
 * back through `new Date(iso)` west of Greenwich renders December 30th. The
 * sheet shipped with the property row fixed and the stats strip two inches
 * above it not, so the same deal claimed two different close dates.
 */
/** The shape `formatDay` renders, in whatever locale the suite is running in. */
const asDay = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

describe("day strings", () => {
	it("round-trips a date through its local parts", () => {
		// Late enough in the day that a UTC-based conversion would roll over to
		// the 1st anywhere east of Greenwich.
		const date = new Date(2026, 11, 31, 23, 30);
		expect(toDay(date)).toBe("2026-12-31");
		expect(toDay(fromDay(toDay(date)) as Date)).toBe("2026-12-31");
	});

	it("pads single-digit months and days", () => {
		expect(toDay(new Date(2026, 0, 5))).toBe("2026-01-05");
	});

	it("reads the day the server stored, not the local rendering of it", () => {
		// What the API returns for a deal closing on the 31st.
		//
		// Asserted against the runtime's own rendering of that day rather than
		// against "Dec 31, 2026". `formatDay` formats in the reader's locale, so
		// the literal is only correct on an en-US machine: the suite failed on a
		// contributor's en-GB laptop, which renders "31 Dec 2026". The day is
		// what this test is about, and the day is what it now compares.
		expect(formatDay("2026-12-31T00:00:00.000Z")).toBe(
			asDay.format(new Date(2026, 11, 31)),
		);
		expect(fromDay("2026-12-31T00:00:00.000Z")?.getDate()).toBe(31);
	});

	it("has nothing to show for nothing", () => {
		expect(fromDay(null)).toBeUndefined();
		expect(fromDay("")).toBeUndefined();
		expect(fromDay("someday")).toBeUndefined();
		expect(formatDay(null)).toBe("—");
	});
});
