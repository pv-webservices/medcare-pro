"use client";
import { useEffect, useState, useRef } from "react";
import QRCode from "react-qr-code";
type Status = {
  status: string;
  patientCode: string;
  loginUrl: string;
  activatedAt: string | null;
  lastLoginAt: string | null;
  activationUrl?: string;
  expiresAt?: string;
};
export default function StaffPortalCard({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const [state, setState] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dialog = useRef<HTMLDialogElement>(null);
  const qrDialog = useRef<HTMLDialogElement>(null);
  const publicQrDialog = useRef<HTMLDialogElement>(null);
  const endpoint = `/api/patients/${patientId}/portal`;
  useEffect(() => {
    let alive = true;
    fetch(endpoint, { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (alive) {
          if (result.success) setState(result.data);
          else setError(result.error);
        }
      })
      .catch(() => {
        if (alive) setError("Portal status is unavailable.");
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  function clearQR() {
    setState((s) =>
      s ? { ...s, activationUrl: undefined, expiresAt: undefined } : s,
    );
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${endpoint}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "revoke" ? {} : { identityVerified: true },
        ),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setState(result.data);
      dialog.current?.close();
      if (result.data.activationUrl) qrDialog.current?.showModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Portal action failed.");
    } finally {
      setBusy(false);
    }
  }
  function open(next: string) {
    setAction(next);
    setError("");
    dialog.current?.showModal();
  }
  const live =
    !!state?.activationUrl &&
    !!state.expiresAt &&
    new Date(state.expiresAt).getTime() > now;
  return (
    <section
      className="space-y-3 rounded-2xl border border-line bg-canvas p-5"
      aria-labelledby="staff-portal-title"
    >
      <h2 id="staff-portal-title" className="text-lg font-semibold">
        Patient Portal
      </h2>
      {state && (
        <>
          <p>{state.status}</p>
          <p>Patient ID: {state.patientCode}</p>
          {state.activatedAt && (
            <p>Activated: {new Date(state.activatedAt).toLocaleDateString()}</p>
          )}
          {state.lastLoginAt && (
            <p>
              Last login: {new Date(state.lastLoginAt).toLocaleDateString()}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {state.status !== "ACTIVE" && (
              <button
                className="min-h-11 rounded-lg border border-line px-4"
                onClick={() =>
                  open(
                    ["PENDING ACTIVATION", "RECOVERY PENDING"].includes(
                      state.status,
                    )
                      ? "resend"
                      : "activate",
                  )
                }
              >
                {["PENDING ACTIVATION", "RECOVERY PENDING"].includes(
                  state.status,
                )
                  ? "Generate New QR"
                  : state.status === "SETUP REQUIRED"
                    ? "Generate Setup QR"
                    : state.status === "REVOKED"
                      ? "Enable Again"
                      : "Enable Patient Portal"}
              </button>
            )}
            {state.status === "ACTIVE" && (
              <button
                className="min-h-11 rounded-lg border border-line px-4"
                onClick={() => open("recovery")}
              >
                Reset Portal Access
              </button>
            )}
            {state.status !== "NOT ENABLED" && state.status !== "REVOKED" && (
              <button
                className="min-h-11 rounded-lg border border-line px-4"
                onClick={() => open("revoke")}
              >
                Revoke Access
              </button>
            )}
            <button
              className="min-h-11 rounded-lg border border-line px-4"
              onClick={() => {
                void navigator.clipboard
                  .writeText(state.loginUrl)
                  .catch(() =>
                    setError("Unable to copy the public login link."),
                  );
              }}
            >
              Copy Patient Login Link
            </button>
            <button
              className="min-h-11 rounded-lg border border-line px-4"
              onClick={() => publicQrDialog.current?.showModal()}
            >
              Show Public Login QR
            </button>
          </div>
          <p className="text-sm">
            PATIENT LOGIN LINK — PUBLIC. Contains no patient identity or
            authentication secret.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <dialog
        ref={dialog}
        aria-labelledby="portal-confirm-heading"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 text-black backdrop:bg-black/40"
      >
        <h3 id="portal-confirm-heading" className="mb-3 text-lg font-semibold">
          {action === "revoke"
            ? "Revoke patient portal access?"
            : "Confirm patient identity"}
        </h3>
        <p>
          {action === "revoke"
            ? "The patient will immediately lose access to their records. Existing clinical records will not be deleted."
            : "Before enabling portal access, confirm that you have verified this patient's identity in person."}
        </p>
        {action === "recovery" && (
          <p>
            Resetting access disables the old password, revokes every session
            and clears the recovery email. The patient must create a fresh
            password.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            disabled={busy}
            className="min-h-11 rounded-lg border px-4"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            disabled={busy}
            className="min-h-11 rounded-lg bg-teal-900 px-4 text-white"
            onClick={() => void confirm()}
          >
            {busy
              ? "Please wait…"
              : action === "revoke"
                ? "Revoke access"
                : "Identity verified — enable portal"}
          </button>
        </div>
      </dialog>
      <dialog
        ref={qrDialog}
        aria-labelledby="portal-qr-heading"
        onClose={clearQR}
        className="portal-qr-dialog m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 text-black backdrop:bg-black/40"
      >
        <div className="portal-activation-card">
          <h3 id="portal-qr-heading" className="text-lg font-semibold">
            Patient Portal Activation
          </h3>
          <p>{patientName}</p>
          <p>Patient ID: {state?.patientCode}</p>
          <p className="text-sm font-semibold text-amber-800">
            ACTIVATION QR — SECRET
          </p>
          {live ? (
            <div className="mx-auto my-4 w-fit bg-white p-4">
              <QRCode
                value={state!.activationUrl!}
                size={224}
                style={{ maxWidth: "100%", height: "auto" }}
                title="One-time Patient Portal activation QR"
              />
            </div>
          ) : (
            <p role="status">QR expired. Generate a new QR.</p>
          )}
          <p>
            Expires in 15 minutes
            {live && state?.expiresAt
              ? ` · ${Math.ceil((new Date(state.expiresAt).getTime() - now) / 60000)} minutes remaining`
              : ""}
          </p>
          <p>Ask the patient to scan this code using their own device.</p>
        </div>
        <div className="portal-qr-actions mt-5 flex flex-wrap gap-3">
          <button
            className="min-h-11 rounded-lg border px-4"
            disabled={!live}
            onClick={() => window.print()}
          >
            Print activation card
          </button>
          <button
            className="min-h-11 rounded-lg border px-4"
            onClick={() => {
              qrDialog.current?.close();
              open("resend");
            }}
          >
            Generate new QR
          </button>
          <button
            className="min-h-11 rounded-lg border px-4"
            onClick={() => qrDialog.current?.close()}
          >
            Close
          </button>
        </div>
      </dialog>
      <dialog
        ref={publicQrDialog}
        aria-labelledby="portal-public-qr-heading"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 text-black backdrop:bg-black/40"
      >
        <div className="text-center">
          <h3 id="portal-public-qr-heading" className="text-lg font-semibold">
            Patient Login QR — Public
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Scan to open your clinic&apos;s Patient Portal login page.
          </p>
          <div className="mx-auto my-4 w-fit bg-white p-4">
            <QRCode
              value={state?.loginUrl ?? ""}
              size={200}
              style={{ maxWidth: "100%", height: "auto" }}
              title="Patient Login QR — Public"
            />
          </div>
          <p className="text-xs font-mono text-gray-500 break-all">
            {state?.loginUrl}
          </p>
          <p className="mt-3 text-xs text-gray-500">
            PATIENT LOGIN QR — PUBLIC. Contains no patient identity or
            authentication secret.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              className="min-h-11 rounded-lg border px-4"
              onClick={() => publicQrDialog.current?.close()}
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
      <style>{`@media print { body:has(.portal-qr-dialog[open]) * { visibility: hidden; } body:has(.portal-qr-dialog[open]) .portal-activation-card, body:has(.portal-qr-dialog[open]) .portal-activation-card * { visibility: visible; } .portal-qr-dialog[open] { position: absolute; inset: 0; margin: 0 auto; border: 0; } .portal-qr-actions { display: none; } }`}</style>
    </section>
  );
}
