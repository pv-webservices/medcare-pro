"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MEDIA_TYPES } from "@/lib/whatsapp";
import {
  PLACEHOLDER_LABELS,
  TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders,
} from "@/lib/whatsappTemplateText";
import type { TemplateRecord } from "@/lib/whatsappTemplates";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Card from "@/components/ui/Card";

/**
 * The approved message set — PRD §6.9 (FR-9.1).
 *
 * This provider has no template approval of its own, so this list IS the
 * approved set: the send screen can only choose from it, and no endpoint in
 * the app accepts a free-typed body. Editing is gated on `message:template`
 * separately from `message:send`, so the front desk sends the wording but does
 * not rewrite it.
 *
 * Placeholders are validated as you type. A body referring to `{doctrName}`
 * is refused at save rather than going out with a literal brace in it.
 */

interface TemplateManagerProps {
  templates: readonly TemplateRecord[];
  canManage: boolean;
}

interface DraftState {
  id: string | null;
  name: string;
  body: string;
  footer: string;
  mediaType: string;
  mediaUrl: string;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  name: "",
  body: "",
  footer: "",
  mediaType: "",
  mediaUrl: "",
};

export default function TemplateManager({
  templates,
  canManage,
}: TemplateManagerProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const badTokens = draft ? unknownPlaceholders(draft.body) : [];
  const mediaHalfSet = draft
    ? Boolean(draft.mediaType) !== Boolean(draft.mediaUrl)
    : false;
  const canSave =
    draft !== null &&
    draft.name.trim() !== "" &&
    draft.body.trim() !== "" &&
    badTokens.length === 0 &&
    !mediaHalfSet;

  async function send(method: "POST" | "PATCH" | "DELETE", body: object) {
    setError(null);
    try {
      const response = await fetch("/api/whatsapp/templates", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        // Covers the 409 for a duplicate name, written for the user by the server.
        setError(payload.error ?? "Could not save that template. Try again.");
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canSave) return;

    setIsSaving(true);
    const payload = {
      name: draft.name,
      body: draft.body,
      footer: draft.footer,
      mediaType: draft.mediaType,
      mediaUrl: draft.mediaUrl,
    };

    const ok = draft.id
      ? await send("PATCH", { templateId: draft.id, ...payload })
      : await send("POST", payload);

    if (ok) {
      setDraft(null);
    }
    setIsSaving(false);
  }

  async function handleDelete(templateId: string) {
    setRemovingId(templateId);
    await send("DELETE", { templateId });
    setRemovingId(null);
  }

  function insertPlaceholder(token: string) {
    setDraft((current) =>
      current === null ? current : { ...current, body: `${current.body}{${token}}` },
    );
  }

  return (
    <section aria-labelledby="templates-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 id="templates-heading" className="text-heading font-semibold text-ink">
            Message templates
          </h2>
          <p className="mt-1 text-body text-muted">
            Only these can be sent. Nothing else goes out from this account.
          </p>
        </div>
        {canManage && draft === null && (
          <Button onClick={() => setDraft({ ...EMPTY_DRAFT })} variant="primary">
            Add template
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      {draft && (
        <Card className="mb-6 p-4 sm:p-6 bg-canvas-deep border-line">
          <form
            onSubmit={handleSubmit}
            className="grid gap-6"
          >
          <div className="max-w-md">
            <Input
              id="template-name"
              name="name"
              label="Template name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              required
              maxLength={120}
              placeholder="e.g. Appointment reminder"
            />
          </div>

          <div>
            <label htmlFor="template-body" className="mb-1.5 block text-body font-medium text-ink">
              Message
            </label>
            <textarea
              id="template-body"
              value={draft.body}
              onChange={(event) =>
                setDraft({ ...draft, body: event.target.value })
              }
              required
              rows={5}
              maxLength={4000}
              aria-invalid={badTokens.length > 0}
              aria-describedby="template-body-help"
              className={`block w-full rounded-lg border bg-canvas px-3 py-2 text-body outline-none transition-colors   ${badTokens.length > 0 ? "border-line focus:border-line" : "border-line"}`}
            />
            <p
              id="template-body-help"
              className={`mt-2 text-meta ${
                badTokens.length > 0
                  ? "text-alert-ink"
                  : "text-muted"
              }`}
            >
              {badTokens.length > 0
                ? `Nothing can fill {${badTokens[0]}}. Use one of the placeholders below.`
                : "Tap a placeholder to insert it. Each is filled per patient when the message is sent."}
            </p>

            <ul className="mt-3 flex flex-wrap gap-2">
              {TEMPLATE_PLACEHOLDERS.map((token) => (
                <li key={token}>
                  <button
                    type="button"
                    onClick={() => insertPlaceholder(token)}
                    className="min-h-8 rounded-lg bg-canvas px-2.5 text-meta font-medium text-ink hover:bg-canvas-deep hover:border-line transition-colors border border-line shadow-card"
                  >
                    {PLACEHOLDER_LABELS[token]}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="max-w-md">
            <Input
              id="template-footer"
              name="footer"
              label="Footer"
              hint="Optional."
              value={draft.footer}
              onChange={(event) =>
                setDraft({ ...draft, footer: event.target.value })
              }
              maxLength={255}
              placeholder="e.g. Sent by Alpha Clinic"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div>
              <Select
                id="template-media-type"
                name="mediaType"
                label="Attach"
                value={draft.mediaType}
                onChange={(event) =>
                  setDraft({ ...draft, mediaType: event.target.value })
                }
              >
                <option value="">Text only</option>
                {MEDIA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Input
                id="template-media-url"
                name="mediaUrl"
                label="File link"
                type="url"
                value={draft.mediaUrl}
                onChange={(event) =>
                  setDraft({ ...draft, mediaUrl: event.target.value })
                }
                maxLength={2000}
                placeholder="https://example.com/leaflet.pdf"
                error={mediaHalfSet ? "Set both the attachment type and the file link, or neither." : undefined}
                hint={!mediaHalfSet ? "Must be a direct link — a Drive or Dropbox share page will not work." : undefined}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              type="submit"
              disabled={!canSave || isSaving}
              variant="primary"
              isBusy={isSaving}
              busyLabel="Saving…"
            >
              {draft.id ? "Save Template" : "Create Template"}
            </Button>
            <Button
              type="button"
              onClick={() => setDraft(null)}
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
        </form>
        </Card>
      )}

      {templates.length === 0 ? (
        <div className="rounded-3xl border border-line bg-canvas px-6 py-10 text-center shadow-card">
          <p className="mb-1 font-semibold text-ink">No templates yet</p>
          <p className="text-body text-muted">
            {canManage
              ? "Add one before anything can be sent to patients."
              : "Ask an admin to add one before you can message patients."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="rounded-2xl border border-line bg-canvas p-5 shadow-card"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <p className="font-semibold text-ink">{template.name}</p>
                {template.mediaType && (
                  <span className="rounded-lg bg-canvas-deep px-2 py-1 text-meta font-medium text-muted">
                    {template.mediaType}
                  </span>
                )}
              </div>

              <p className="whitespace-pre-wrap text-body text-ink">
                {template.body}
              </p>

              {template.footer && (
                <p className="mt-3 text-meta text-faint">
                  {template.footer}
                </p>
              )}

              {canManage && (
                <div className="mt-5 flex flex-wrap gap-2 pt-4 border-t border-line">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setDraft({
                        id: template.id,
                        name: template.name,
                        body: template.body,
                        footer: template.footer ?? "",
                        mediaType: template.mediaType ?? "",
                        mediaUrl: template.mediaUrl ?? "",
                      })
                    }
                  >
                    Edit Template
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDelete(template.id)}
                    disabled={removingId === template.id}
                    className="min-h-10 rounded-lg px-3 text-body font-medium text-muted hover:bg-canvas-deep hover:text-ink disabled:opacity-50 transition-colors"
                  >
                    {removingId === template.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
