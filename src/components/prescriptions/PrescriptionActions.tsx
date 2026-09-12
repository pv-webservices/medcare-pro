"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";

export default function PrescriptionActions({
  id,
  mayCorrect,
  mayCancel,
}: {
  id: string;
  mayCorrect: boolean;
  mayCancel: boolean;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action: "correct" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/prescriptions/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "cancel" ? { reason } : {}),
      });
      const body = (await response.json()) as {
        success: boolean;
        error?: string;
        data?: { registrationId: string };
      };
      if (!response.ok || !body.success)
        throw new Error(body.error || "Action failed.");
      if (action === "correct" && body.data)
        router.push(`/registration/${body.data.registrationId}/consultation`);
      else {
        setCancelling(false);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          className="text-accent underline"
          href={`/prescriptions/${id}/print`}
        >
          Print prescription
        </Link>
        {mayCorrect && (
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => act("correct")}
          >
            Create corrected version
          </Button>
        )}
        {mayCancel && (
          <Button
            disabled={busy}
            variant="danger"
            onClick={() => setCancelling(true)}
          >
            Cancel prescription
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-alert-ink">
          {error}
        </p>
      )}
      <Modal
        isOpen={cancelling}
        onClose={() => setCancelling(false)}
        isBusy={busy}
        title="Cancel prescription"
        description="This voids the prescription and permanently retains its original medical record."
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setCancelling(false)}
            >
              Keep prescription
            </Button>
            <Button
              variant="dangerSolid"
              isBusy={busy}
              disabled={!reason.trim()}
              onClick={() => act("cancel")}
            >
              Confirm cancellation
            </Button>
          </>
        }
      >
        <Textarea
          id="cancellation-reason"
          label="Cancellation reason"
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <p role="alert" className="mt-3 text-alert-ink">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}
