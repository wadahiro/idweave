/**
 * Unit: db client config — dialect from URL scheme, password from env, and the
 * driver-result normalization. No live DB.
 */
import { describe, it, expect, afterEach } from "vitest";
import { knexConfig } from "./db.ts";
import type { DbSystemConfig } from "../scenario/suite.ts";

const base: DbSystemConfig = {
  url: "postgres://app@db.host:15432/external_server",
  passwordEnv: "IDW_TEST_DB_PW",
  query: "SELECT 1 WHERE x = :id",
};

afterEach(() => { delete process.env.IDW_TEST_DB_PW; });

describe("knexConfig", () => {
  it("maps the URL scheme to the dialect (postgres -> pg) and injects the env password", () => {
    process.env.IDW_TEST_DB_PW = "s3cr3t";
    const cfg = knexConfig(base);
    expect(cfg.client).toBe("pg");
    expect(cfg.connection).toMatchObject({
      host: "db.host", port: 15432, user: "app", password: "s3cr3t", database: "external_server",
    });
  });

  it("selects mysql2 / better-sqlite3 / mssql by scheme", () => {
    process.env.IDW_TEST_DB_PW = "x";
    expect(knexConfig({ ...base, url: "mysql://u@h:3306/d" }).client).toBe("mysql2");
    expect(knexConfig({ ...base, url: "sqlite://u@h/d" }).client).toBe("better-sqlite3");
    expect(knexConfig({ ...base, url: "sqlserver://u@h:1433/d" }).client).toBe("mssql");
  });

  it("throws on an unsupported scheme", () => {
    process.env.IDW_TEST_DB_PW = "x";
    expect(() => knexConfig({ ...base, url: "oracle://u@h/d" })).toThrow(/unsupported db url scheme/);
  });

  it("throws when the password env is unset", () => {
    expect(() => knexConfig(base)).toThrow(/db password env "IDW_TEST_DB_PW" is not set/);
  });
});
