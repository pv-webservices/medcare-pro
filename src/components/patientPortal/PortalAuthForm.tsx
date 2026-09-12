"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function PortalAuthForm({
  token,
  maskedMobile,
}: {
  token?: string;
  maskedMobile?: string;
}) {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(verify: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/patient-portal/auth/${token ? "activation" : "login"}/${verify ? "verify" : "request"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(token ? { token } : { mobile }),
            ...(verify ? { code } : {}),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (verify) {
        router.replace("/patient");
        router.refresh();
      } else {
        setSent(true);
        setMessage(result.data.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again later.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="portal-auth"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(sent);
      }}
    >
      <p className="portal-eyebrow">PRIVATE ACCESS · MEDCARE PRO</p>
      <h1>{token ? "Activate your portal" : "Your care, in one place."}</h1>
      <p className="portal-muted">
        {token
          ? `Verify the mobile number ${maskedMobile} confirmed by your clinic.`
          : "Sign in to securely view your visits and prescriptions."}
      </p>
      {!token && (
        <label>
          Mobile number
          <input
            type="tel"
            autoComplete="tel"
            aria-describedby="portal-feedback"
            aria-invalid={!!error}
            inputMode="tel"
            value={mobile}
            required
            maxLength={30}
            disabled={sent}
            onChange={(e) => setMobile(e.target.value)}
          />
        </label>
      )}
      {sent && (
        <label>
          Verification code
          <input
            autoComplete="one-time-code"
            aria-invalid={!!error}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            required
            aria-describedby="portal-feedback"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      )}
      <div id="portal-feedback" aria-live="polite">
        {error ? <p role="alert">{error}</p> : message && <p>{message}</p>}
      </div>
      <button className="portal-primary" disabled={busy}>
        {busy
          ? "Please wait…"
          : sent
            ? "Verify and continue"
            : "Send verification code"}
      </button>
      {sent && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(false)}
        >
          Resend code
        </button>
      )}
      {!token && sent && (
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setCode("");
            setError("");
          }}
        >
          Use another number
        </button>
      )}
      <p className="portal-footnote">
        Portal access is enabled by your clinic after identity verification.
        Profile corrections are managed by the clinic.
      </p>
    </form>
  );
}
