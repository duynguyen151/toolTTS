import { describe, expect, it, vi } from "vitest";

const postgresMock = vi.fn(() => ({
  end: vi.fn(),
  options: {
    parsers: {},
    serializers: {}
  }
}));

vi.mock("postgres", () => ({
  default: postgresMock
}));

describe("createDatabase transport security", () => {
  it("requires TLS for Supabase pooler connections", async () => {
    const { createDatabase } = await import("./client.js");

    createDatabase("postgresql://user:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres");

    expect(postgresMock).toHaveBeenCalledWith(
      "postgresql://user:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
      expect.objectContaining({ ssl: "require" })
    );
  });

  it("does not force Supabase TLS settings onto local PostgreSQL", async () => {
    const { createDatabase } = await import("./client.js");

    createDatabase("postgresql://user:password@127.0.0.1:5432/postgres");

    expect(postgresMock).toHaveBeenCalledWith(
      "postgresql://user:password@127.0.0.1:5432/postgres",
      expect.not.objectContaining({ ssl: "require" })
    );
  });
});
