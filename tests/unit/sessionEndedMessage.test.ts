import { describe, expect, it } from "vitest";
import {
  SESSION_ENDED_DEFAULT_MESSAGE,
  SESSION_ENDED_REASONS,
  SESSION_EXPIRED_MESSAGE,
  SESSION_SIGN_IN_AGAIN_MESSAGE,
  getSessionEndedMessage,
} from "@/lib/sessionEndedMessage";

/** Both URLSearchParams and Next's ReadonlyURLSearchParams satisfy this. */
function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("getSessionEndedMessage", () => {
  it("says nothing on a plain visit to the login page", () => {
    expect(getSessionEndedMessage(params(""))).toBeNull();
  });

  it("shows the default sentence for ended=1 with no reason", () => {
    expect(getSessionEndedMessage(params("ended=1"))).toBe(SESSION_ENDED_DEFAULT_MESSAGE);
  });

  it("gives an expired session its own sentence", () => {
    expect(getSessionEndedMessage(params("ended=1&reason=expired"))).toBe(
      SESSION_EXPIRED_MESSAGE,
    );
  });

  it("uses the neutral sentence for a revoked session", () => {
    expect(getSessionEndedMessage(params("ended=1&reason=session-revoked"))).toBe(
      SESSION_SIGN_IN_AGAIN_MESSAGE,
    );
  });

  it("handles every reason the dashboard shell can set", () => {
    for (const reason of SESSION_ENDED_REASONS) {
      const message = getSessionEndedMessage(params(`ended=1&reason=${reason}`));
      expect(typeof message).toBe("string");
      expect(message).not.toBe("");
    }
  });
});

describe("the reason is never disclosed", () => {
  it("does not confirm that an account was suspended", () => {
    // The parameter is forgeable — anyone can type it — so answering it with
    // "your account is suspended" would confirm a state to a stranger.
    const message = getSessionEndedMessage(params("ended=1&reason=account-suspended"));
    expect(message).toBe(SESSION_SIGN_IN_AGAIN_MESSAGE);
    expect(message?.toLowerCase()).not.toContain("suspend");
  });

  it("does not confirm that an organisation was suspended", () => {
    const message = getSessionEndedMessage(params("ended=1&reason=tenant-suspended"));
    expect(message).toBe(SESSION_SIGN_IN_AGAIN_MESSAGE);
    expect(message?.toLowerCase()).not.toContain("suspend");
    expect(message?.toLowerCase()).not.toContain("clinic");
  });

  it("never returns anything but one of its own three sentences", () => {
    const allowed = [
      SESSION_ENDED_DEFAULT_MESSAGE,
      SESSION_EXPIRED_MESSAGE,
      SESSION_SIGN_IN_AGAIN_MESSAGE,
    ];
    const reasons = [
      "",
      "expired",
      "session-revoked",
      "account-suspended",
      "tenant-suspended",
      "banana",
      "revoked",
      "EXPIRED",
    ];
    for (const reason of reasons) {
      const message = getSessionEndedMessage(params(`ended=1&reason=${reason}`));
      expect(allowed).toContain(message);
    }
  });
});

describe("an unknown reason is ignored rather than echoed", () => {
  it("falls back to the default for a reason it does not recognise", () => {
    expect(getSessionEndedMessage(params("ended=1&reason=whatever"))).toBe(
      SESSION_ENDED_DEFAULT_MESSAGE,
    );
  });

  it("is case-sensitive, so a near-miss falls back rather than guessing", () => {
    expect(getSessionEndedMessage(params("ended=1&reason=Expired"))).toBe(
      SESSION_ENDED_DEFAULT_MESSAGE,
    );
  });

  it("does not render attacker-supplied text", () => {
    const injected = "<script>alert(1)</script>";
    const message = getSessionEndedMessage(
      params(`ended=1&reason=${encodeURIComponent(injected)}`),
    );
    expect(message).toBe(SESSION_ENDED_DEFAULT_MESSAGE);
    expect(message).not.toContain("script");
  });

  it("ignores a very long reason without truncating it into the page", () => {
    const message = getSessionEndedMessage(params(`ended=1&reason=${"x".repeat(5000)}`));
    expect(message).toBe(SESSION_ENDED_DEFAULT_MESSAGE);
  });
});

describe("only ended=1 opts in", () => {
  it("ignores a reason with no ended flag", () => {
    // Middleware only lets a request through to /login with ended=1, so a bare
    // reason cannot arrive at all — and if one does, it means nothing.
    expect(getSessionEndedMessage(params("reason=session-revoked"))).toBeNull();
    expect(getSessionEndedMessage(params("reason=expired"))).toBeNull();
  });

  it("matches middleware's test exactly, so the two cannot disagree", () => {
    for (const value of ["0", "true", "yes", "", "01", " 1"]) {
      expect(getSessionEndedMessage(params(`ended=${encodeURIComponent(value)}`))).toBeNull();
    }
    expect(getSessionEndedMessage(params("ended=1"))).not.toBeNull();
  });

  it("survives a missing or null search-params object", () => {
    expect(getSessionEndedMessage(null)).toBeNull();
    expect(getSessionEndedMessage(undefined)).toBeNull();
  });

  it("accepts any object with a get(), not just URLSearchParams", () => {
    const stub = { get: (name: string) => (name === "ended" ? "1" : null) };
    expect(getSessionEndedMessage(stub)).toBe(SESSION_ENDED_DEFAULT_MESSAGE);
  });
});
