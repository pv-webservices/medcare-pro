"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const isSlug = (val: string) => {
  const s = val.trim().toLowerCase();
  return (
    s.length > 0 && s.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)
  );
};

export default function PortalAuthForm({
  token,
  organization = "",
  clinicName = null,
  mode = token ? "activate" : "login",
}: {
  token?: string;
  organization?: string;
  clinicName?: string | null;
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
  const hasClinicContext = Boolean(organization && isSlug(organization));

  async function submit() {
    setError("");
    setMessage("");
    if (identity && !isSlug(org)) {
      setError("Enter your Clinic Access Code, for example sharma-clinic.");
      return;
    }
    if (newPassword && password !== confirmPassword) {
      setError("Passwords must match.");
      return;
    }
    setBusy(true);
    try {
      const body =
        mode === "login"
          ? {
              organization: org.trim(),
              patientCode: patientCode.trim(),
              password,
            }
          : mode === "forgot-password"
            ? {
                organization: org.trim(),
                patientCode: patientCode.trim(),
                email: email.trim(),
              }
            : mode === "verify-email"
              ? { token }
              : {
                  token,
                  password,
                  ...(mode === "activate" && email
                    ? { email: email.trim() }
                    : {}),
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
        const targetOrg = result.data?.tenantSlug || org || organization;
        const query = targetOrg
          ? `?org=${encodeURIComponent(targetOrg)}&reset=complete`
          : "?reset=complete";
        router.replace(`/patient/login${query}`);
        router.refresh();
      } else {
        setMessage(result.data.message);
        if (result.data?.tenantSlug) {
          setOrg(result.data.tenantSlug);
        }
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
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="portal-eyebrow">PRIVATE ACCESS · MEDCARE PRO</p>
      {hasClinicContext && mode === "login" ? (
        <div className="portal-clinic-context">
          <h1 className="portal-clinic-name">
            {clinicName || "Clinic Portal"}
          </h1>
          <p className="portal-clinic-subhead">Patient Portal</p>
        </div>
      ) : hasClinicContext && mode === "forgot-password" ? (
        <div className="portal-clinic-context">
          <h1 className="portal-clinic-name">
            {clinicName || "Clinic Portal"}
          </h1>
          <p className="portal-clinic-subhead">Patient Portal</p>
          <h2 className="portal-mode-heading">Forgot password?</h2>
        </div>
      ) : (
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
      )}
      {identity && (
        <>
          {!hasClinicContext && (
            <div>
              <label htmlFor="clinic-access-code">Clinic Access Code</label>
              <input
                id="clinic-access-code"
                required
                autoComplete="organization"
                aria-describedby="clinic-access-code-hint"
                maxLength={100}
                value={org}
                onChange={(e) => setOrg(e.target.value)}
              />
              <span id="clinic-access-code-hint" className="portal-field-hint">
                Find this code on your clinic&apos;s Patient Portal link, receipt
                or prescription. Example: sharma-clinic
              </span>
            </div>
          )}
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
      {mode !== "login" && (
        <Link
          href={
            org || organization
              ? `/patient/login?org=${encodeURIComponent(org || organization)}`
              : "/patient/login"
          }
        >
          Back to sign in
        </Link>
      )}
    </form>
  );
}
