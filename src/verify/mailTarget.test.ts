/**
 * Unit: projectMail + mailQuery — the pure mail projection/normalization and the
 * Mailpit search query. No Mailpit server.
 */
import { describe, it, expect } from "vitest";
import { projectMail, mailQuery, evaluateMail, extractMailLink, type MailProjection } from "./mailTarget.ts";
import type { MailMessage } from "../clients/mailpit.ts";

const MSG: MailMessage = {
  ID: "RcGKyUuyWy5qpQEcPAygaD",
  From: { Name: "IDM System", Address: "noreply@example.com" },
  To: [
    { Name: "", Address: "zoe@example.com" },
    { Name: "", Address: "jdoe@example.com" },
  ],
  Cc: [{ Name: "", Address: "boss@example.com" }],
  Bcc: [{ Name: "", Address: "audit@example.com" }],
  Subject: "Welcome to Example",
  Date: "2026-06-05T00:32:45.055Z",
  Text: "Hello John,\r\nYour account has been created.\r\nRegards.\r\n",
  HTML: "",
};

describe("projectMail", () => {
  it("projects from/to/cc/bcc/subject/text and drops the volatile envelope", () => {
    expect(projectMail(MSG)).toEqual({
      from: "IDM System <noreply@example.com>", // display name kept
      to: ["jdoe@example.com", "zoe@example.com"], // multiple recipients, sorted
      cc: ["boss@example.com"],
      bcc: ["audit@example.com"],
      subject: "Welcome to Example",
      text: "Hello John,\nYour account has been created.\nRegards.", // CRLF→LF, trailing trimmed
    });
  });

  it("sorts every recipient list so address order is irrelevant", () => {
    const out = projectMail({
      ...MSG,
      To: [{ Name: "", Address: "c@x" }, { Name: "", Address: "a@x" }, { Name: "", Address: "b@x" }],
    });
    expect(out.to).toEqual(["a@x", "b@x", "c@x"]);
  });

  it("omits cc and bcc when there are none", () => {
    const out = projectMail({ ...MSG, Cc: null, Bcc: null });
    expect(out.cc).toBeUndefined();
    expect(out.bcc).toBeUndefined();
  });

  it("uses the bare address when there is no display name", () => {
    const out = projectMail({ ...MSG, From: { Name: "", Address: "midpoint@example.com" } });
    expect(out.from).toBe("midpoint@example.com");
  });

  it("tolerates a missing From and empty body", () => {
    const out = projectMail({ ...MSG, From: null, Text: "" });
    expect(out.from).toBe("");
    expect(out.text).toBe("");
  });
});

describe("mailQuery", () => {
  it("matches by recipient, optionally narrowed by a quoted subject", () => {
    expect(mailQuery("jdoe@example.com")).toBe("to:jdoe@example.com");
    expect(mailQuery("jdoe@example.com", "Welcome to Example")).toBe('to:jdoe@example.com subject:"Welcome to Example"');
  });
});

const PROJ: MailProjection = {
  from: "noreply@example.com",
  to: ["jdoe@example.com"],
  subject: "Complete your registration",
  text: "Hi, click https://idm-dev.example.com/registration?token=abc123 to finish.",
};

describe("evaluateMail", () => {
  it("passes when every contains substring and matches regex is satisfied", () => {
    expect(evaluateMail(PROJ, { contains: ["Complete your registration", "click"] })).toEqual([]);
    expect(evaluateMail(PROJ, { matches: ["registration\\?token=\\w+"] })).toEqual([]);
  });
  it("reports each unmet contains/matches", () => {
    const f = evaluateMail(PROJ, { contains: ["password reset"], matches: ["https://other/"] });
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/must contain: "password reset"/);
    expect(f[1]).toMatch(/must match/);
  });
});

describe("extractMailLink", () => {
  it("returns the first http(s) URL by default", () => {
    expect(extractMailLink({ text: PROJ.text, html: "" })).toBe(
      "https://idm-dev.example.com/registration?token=abc123",
    );
  });
  it("uses a pattern's capture group when given", () => {
    expect(extractMailLink({ text: PROJ.text, html: "" }, "token=(\\w+)")).toBe("abc123");
  });
  it("falls back to the HTML body and returns null when no link", () => {
    expect(extractMailLink({ text: "no link here", html: '<a href="https://x/approve/9">go</a>' })).toBe(
      "https://x/approve/9",
    );
    expect(extractMailLink({ text: "nothing", html: "" })).toBeNull();
  });
});
