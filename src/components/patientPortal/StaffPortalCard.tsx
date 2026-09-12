"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
type Status = {
  status: string;
  mobile: string;
  activatedAt: string | null;
  lastLoginAt: string | null;
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
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const endpoint = `/api/patients/${patientId}/portal`;
  useEffect(() => {
    let alive = true;
    fetch(endpoint)
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
      router.refresh();
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
          <p>
            {state.status} · Login mobile {state.mobile}
          </p>
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
                    state.status === "PENDING ACTIVATION"
                      ? "resend"
                      : "activate",
                  )
                }
              >
                {state.status === "PENDING ACTIVATION"
                  ? "Resend Activation"
                  : state.status === "REVOKED"
                    ? "Enable Again"
                    : "Enable Patient Portal"}
              </button>
            )}
            {["ACTIVE", "PENDING ACTIVATION"].includes(state.status) && (
              <button
                className="min-h-11 rounded-lg border border-line px-4"
                onClick={() => open("revoke")}
              >
                Revoke Access
              </button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <dialog
        ref={dialog}
        aria-labelledby="portal-confirm-heading"
        className="m-auto max-w-md rounded-2xl bg-white p-6 text-black backdrop:bg-black/40"
        onCancel={() => {
          if (busy) return;
          setAction("");
        }}
      >
        <h3 id="portal-confirm-heading" className="mb-3 text-lg font-semibold">
          {action === "revoke"
            ? "Revoke patient portal access?"
            : "Confirm patient identity"}
        </h3>
        <p>
          {action === "revoke"
            ? "The patient will immediately lose access to their records. Existing clinical records will not be deleted."
            : "Before enabling portal access, confirm that you have verified this patient's identity and their mobile number."}
        </p>
        <p className="my-3">
          Patient: {patientName}
          <br />
          Mobile: {state?.mobile}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="min-h-11 rounded-lg border px-4"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            className="min-h-11 rounded-lg bg-teal-900 px-4 text-white"
            disabled={busy}
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
    </section>
  );
}
