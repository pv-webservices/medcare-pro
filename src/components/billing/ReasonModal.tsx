"use client";
import { useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Input";

/** A destructive billing action that needs a 3–500 character reason (FR-11.17, FR-11.19). */
export default function ReasonModal({ id, isOpen, title, confirmLabel, children, onClose, onConfirm }: {
  id: string; isOpen: boolean; title: string; confirmLabel: string; children: ReactNode;
  onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const length = reason.trim().length;
  async function confirm() {
    setBusy(true); setError("");
    try { await onConfirm(reason.trim()); setReason(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The request failed. Try again."); }
    finally { setBusy(false); }
  }
  return <Modal isOpen={isOpen} onClose={onClose} title={title} isBusy={busy}
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Back</Button>
      <Button variant="dangerSolid" isBusy={busy} disabled={length < 3 || length > 500} onClick={confirm}>{confirmLabel}</Button></>}>
    <div className="space-y-4">{children}
      <Textarea id={id} label="Reason" hint="3 to 500 characters. Kept on the record." value={reason} maxLength={500} required
        onChange={(event) => setReason(event.target.value)} />
      {error && <p role="alert" className="text-alert-ink">{error}</p>}
    </div>
  </Modal>;
}
