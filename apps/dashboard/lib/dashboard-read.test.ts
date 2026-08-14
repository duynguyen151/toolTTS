import { afterEach, describe, expect, it } from "vitest";

import { loadDashboardPresentation } from "./dashboard-read.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("loadDashboardPresentation", () => {
  it("returns an explicitly sanitized presentation when no database is configured", async () => {
    delete process.env.DATABASE_URL;

    const presentation = await loadDashboardPresentation();

    expect(presentation.dataOrigin).toBe("DEMO_SANITIZED");
    expect(presentation.selectedShop.profileNo).toBe("DEMO-001");
    expect(presentation.profile.status).toBe("NOT_VERIFIED");
    expect(presentation.decisionTrace.map((stage) => stage.value)).toEqual([
      "Not verified",
      "Unavailable",
      "Not reviewed",
      "Not requested",
    ]);
  });
});
