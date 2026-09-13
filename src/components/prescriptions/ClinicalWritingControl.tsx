"use client";
import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import {
  FIELD_POLICIES,
  writingResponseSchema,
  type WritingField,
  type WritingResponse,
  type WRITING_MODES,
} from "@/lib/clinical-ai/writingSchemas";
const labels: Record<(typeof WRITING_MODES)[number], string> = {
  SPELLING: "Fix spelling",
  GRAMMAR: "Improve grammar",
  CONCISE: "Make concise",
  CLINICAL_WORDING: "Improve clinical wording",
};
export default function ClinicalWritingControl({
  registrationId,
  field,
  label,
  text,
  onAccept,
}: {
  registrationId: string;
  field: WritingField;
  label: string;
  text: string;
  onAccept: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState<{
    source: string;
    response: WritingResponse;
  } | null>(null);
  const stale = suggestion !== null && suggestion.source !== text;
  async function improve(mode: (typeof WRITING_MODES)[number]) {
    if (inFlight.current) return;
    inFlight.current = true;
    const source = text;
    setBusy(true);
    setOpen(false);
    setMessage("");
    setSuggestion(null);
    try {
      const response = await fetch("/api/clinical-ai/writing-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId, field, mode, text: source }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error("unavailable");
      const checked = writingResponseSchema.parse({
        changed: body.data.changed,
        suggestedText: body.data.suggestedText,
        suggestions: body.data.suggestions,
      });
      if (checked.changed) setSuggestion({ source, response: checked });
      else
        setMessage(
          body.data.status === "SAFETY_REJECTED"
            ? "The suggestion could not be verified as preserving clinical meaning. Your note has not been changed."
            : "No safe language changes suggested.",
        );
    } catch {
      setMessage(
        "AI writing assistance is temporarily unavailable. Your clinical note has not been changed.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (text.trim().length < 3 && !busy && !suggestion && !message) return null;
  return (
    <div
      className="space-y-2 text-sm"
      aria-label={`Writing assistance for ${field}`}
    >
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-label={`Improve writing for ${label}`}
        disabled={
          busy ||
          text.trim().length < 3 ||
          text.length > FIELD_POLICIES[field].maxLength
        }
        onClick={() => setOpen(!open)}
      >
        {busy ? "Analyzing…" : "Improve"}
      </Button>
      {open && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-line p-3">
          {FIELD_POLICIES[field].modes.map((mode) => (
            <Button
              key={mode}
              variant="secondary"
              onClick={() => improve(mode)}
            >
              {labels[mode]}
            </Button>
          ))}
        </div>
      )}
      {open && FIELD_POLICIES[field].semanticRisk !== "MEDIUM" && (
        <p className="text-muted">
          Only language-level corrections are available for this clinical field.
        </p>
      )}
      {message && (
        <p role="status" className="text-muted">
          {message}
        </p>
      )}
      {suggestion && (
        <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
          <h3 className="font-semibold">Clinical Writing Suggestion</h3>
          <div>
            <p className="font-medium">Original</p>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {suggestion.source}
            </p>
          </div>
          <div>
            <p className="font-medium">Suggested</p>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {suggestion.response.suggestedText}
            </p>
          </div>
          <p className="text-muted">
            Language correction; review every suggestion before accepting.
            Accepting updates this field locally. Save the draft to retain it.
          </p>
          {stale && (
            <p role="alert">
              The note changed after this suggestion was generated. Please run
              the assistant again.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (text !== suggestion.source) {
                  setMessage(
                    "The note changed after this suggestion was generated. Please run the assistant again.",
                  );
                  return;
                }
                onAccept(suggestion.response.suggestedText);
                setSuggestion(null);
              }}
            >
              Accept
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSuggestion(null);
                setMessage("");
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
