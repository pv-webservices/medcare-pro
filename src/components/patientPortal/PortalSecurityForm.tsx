"use client";
import { useEffect, useState } from "react";
type Security = {
  recoveryEmail: string | null;
  verified: boolean;
  pendingRecoveryEmail: string | null;
};
export default function PortalSecurityForm({
  activationMessage,
}: {
  activationMessage?: string;
}) {
  const [state, setState] = useState<Security | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState(activationMessage ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/patient-portal/me/security", {
      cache: "no-store",
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    setState(result.data);
  }
  useEffect(() => {
    let alive = true;
    fetch("/api/patient-portal/me/security", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (alive) {
          if (result.success) setState(result.data);
          else setError(result.error);
        }
      })
      .catch(() => {
        if (alive) setError("Security settings are unavailable.");
      });
    return () => {
      alive = false;
    };
  }, []);
  async function submit(resend = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(
        `/api/patient-portal/me/security/${resend ? "resend" : "email"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(resend ? {} : { password, email }),
        },
      );
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setMessage(result.data.message);
      setPassword("");
      setEmail("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again later.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="portal-auth portal-security">
      <h2>Security &amp; Recovery</h2>
      <p>Password configured</p>
      <p>
        {state?.verified
          ? `${state.recoveryEmail} · Verified`
          : "No verified recovery email"}
      </p>
      {state?.pendingRecoveryEmail && (
        <>
          <p>{state.pendingRecoveryEmail} · Verification pending</p>
          <button disabled={busy} onClick={() => void submit(true)}>
            Resend verification
          </button>
        </>
      )}
      <p className="portal-footnote">
        Without a verified recovery email, forgotten-password recovery requires
        identity verification by your clinic.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Current password
          <input
            required
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide password" : "Show password"}
        </button>
        <label>
          New recovery email
          <input
            required
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="portal-primary" disabled={busy}>
          Add or change recovery email
        </button>
      </form>
      <div aria-live="polite">
        {error && <p role="alert">{error}</p>}
        {message && <p>{message}</p>}
      </div>
    </section>
  );
}
