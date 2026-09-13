"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
export default function PortalAuthForm({
  token,
  organization = "",
  mode = token ? "activate" : "login",
}: {
  token?: string;
  organization?: string;
  mode?:
    | "login"
    | "activate"
    | "forgot-password"
    | "reset-password"
    | "verify-email";
}) {
  const router = useRouter();
  const [org, setOrg] = useState(organization);
  const [patientCode, setPatientCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const identity = mode === "login" || mode === "forgot-password";
  const newPassword = mode === "activate" || mode === "reset-password";
  async function submit() {
    setError("");
    setMessage("");
    if (newPassword && password !== confirmPassword) {
      setError("Passwords must match.");
      return;
    }
    setBusy(true);
    try {
      const body =
        mode === "login"
          ? { organization: org, patientCode, password }
          : mode === "forgot-password"
            ? { organization: org, patientCode, email }
            : mode === "verify-email"
              ? { token }
              : {
                  token,
                  password,
                  ...(mode === "activate" && email ? { email } : {}),
                };
      const response = await fetch(`/api/patient-portal/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setPassword("");
      setConfirmPassword("");
      if (mode === "login" || mode === "activate") {
        // Preserve delivery warning for the newly authenticated patient's profile.
        router.replace(
          mode === "activate"
            ? `/patient/profile?activation=${result.data.message.includes("couldn't") ? "email-failed" : "complete"}`
            : "/patient",
        );
        router.refresh();
      } else if (mode === "reset-password") {
        router.replace("/patient/login?reset=complete");
        router.refresh();
      } else setMessage(result.data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again later.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="portal-auth"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="portal-eyebrow">PRIVATE ACCESS · MEDCARE PRO</p>
      <h1>
        {mode === "login"
          ? "Your care, in one place."
          : mode === "activate"
            ? "Create your Patient Portal account"
            : mode === "forgot-password"
              ? "Forgot password?"
              : mode === "verify-email"
                ? "Verify recovery email"
                : "Choose a new password"}
      </h1>
      {identity && (
        <>
          <label>
            Organization
            <input
              required
              autoComplete="organization"
              maxLength={100}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
            />
          </label>
          <label>
            Patient ID
            <input
              required
              autoComplete="username"
              maxLength={100}
              value={patientCode}
              onChange={(e) => setPatientCode(e.target.value)}
            />
          </label>
        </>
      )}
      {(mode === "login" || newPassword) && (
        <>
          <label>
            {newPassword ? "Create password" : "Password"}
            <input
              type={visible ? "text" : "password"}
              required
              minLength={newPassword ? 10 : 1}
              maxLength={128}
              autoComplete={newPassword ? "new-password" : "current-password"}
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
        </>
      )}
      {newPassword && (
        <label>
          Confirm password
          <input
            type={visible ? "text" : "password"}
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
      )}
      {(mode === "activate" || mode === "forgot-password") && (
        <label>
          Recovery email{mode === "activate" ? " (recommended)" : ""}
          <input
            type="email"
            autoComplete="email"
            required={mode === "forgot-password"}
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      )}
      {mode === "activate" && (
        <p className="portal-footnote">
          Adding a verified recovery email lets you reset your password without
          contacting the clinic.{" "}
          {!email &&
            "Without a verified recovery email, forgotten-password recovery will require identity verification by your clinic."}
        </p>
      )}
      {mode === "verify-email" && (
        <p>
          Confirm that this address should be used to recover your Patient
          Portal account.
        </p>
      )}
      <div aria-live="polite">
        {error && <p role="alert">{error}</p>}
        {message && <p>{message}</p>}
      </div>
      <button className="portal-primary" disabled={busy}>
        {busy
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : mode === "activate"
              ? "Activate Patient Portal"
              : mode === "forgot-password"
                ? "Send reset link"
                : mode === "verify-email"
                  ? "Verify recovery email"
                  : "Update password"}
      </button>
      {mode === "login" && (
        <>
          <Link
            href={`/patient/forgot-password${org ? `?org=${encodeURIComponent(org)}` : ""}`}
          >
            Forgot password?
          </Link>
          <p className="portal-footnote">
            Need access? Portal access is enabled by your clinic after identity
            verification.
          </p>
        </>
      )}
      {mode !== "login" && <Link href="/patient/login">Back to sign in</Link>}
    </form>
  );
}
