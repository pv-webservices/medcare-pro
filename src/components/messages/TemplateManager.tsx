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

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

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
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="templates-heading" className="text-lg font-semibold">
            Message templates
          </h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Only these can be sent. Nothing else goes out from this account.
          </p>
        </div>
        {canManage && draft === null && (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
            className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background"
          >
            Add Template
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {draft && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 grid gap-3 rounded border border-black/15 p-3 dark:border-white/20"
        >
          <div className="max-w-sm">
            <label htmlFor="template-name" className="mb-1 block text-sm font-medium">
              Template name
            </label>
            <input
              id="template-name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              required
              maxLength={120}
              placeholder="e.g. Appointment reminder"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="template-body" className="mb-1 block text-sm font-medium">
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
              className="block w-full rounded border border-black/20 bg-transparent p-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60"
            />
            <p
              id="template-body-help"
              className={`mt-1 text-xs ${
                badTokens.length > 0
                  ? "text-red-700 dark:text-red-400"
                  : "text-black/60 dark:text-white/60"
              }`}
            >
              {badTokens.length > 0
                ? `Nothing can fill {${badTokens[0]}}. Use one of the placeholders below.`
                : "Tap a placeholder to insert it. Each is filled per patient when the message is sent."}
            </p>

            <ul className="mt-2 flex flex-wrap gap-2">
              {TEMPLATE_PLACEHOLDERS.map((token) => (
                <li key={token}>
                  <button
                    type="button"
                    onClick={() => insertPlaceholder(token)}
                    className="min-h-9 rounded border border-black/20 px-2 text-xs font-medium dark:border-white/25"
                  >
                    {PLACEHOLDER_LABELS[token]}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="max-w-sm">
            <label htmlFor="template-footer" className="mb-1 block text-sm font-medium">
              Footer <span className="font-normal text-black/55 dark:text-white/55">(optional)</span>
            </label>
            <input
              id="template-footer"
              value={draft.footer}
              onChange={(event) =>
                setDraft({ ...draft, footer: event.target.value })
              }
              maxLength={255}
              placeholder="e.g. Sent by Alpha Clinic"
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div>
              <label htmlFor="template-media-type" className="mb-1 block text-sm font-medium">
                Attach
              </label>
              <select
                id="template-media-type"
                value={draft.mediaType}
                onChange={(event) =>
                  setDraft({ ...draft, mediaType: event.target.value })
                }
                className={INPUT_CLASS}
              >
                <option value="">Text only</option>
                {MEDIA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="template-media-url" className="mb-1 block text-sm font-medium">
                File link
              </label>
              <input
                id="template-media-url"
                type="url"
                value={draft.mediaUrl}
                onChange={(event) =>
                  setDraft({ ...draft, mediaUrl: event.target.value })
                }
                maxLength={2000}
                placeholder="https://example.com/leaflet.pdf"
                aria-describedby="template-media-help"
                className={INPUT_CLASS}
              />
              <p
                id="template-media-help"
                className={`mt-1 text-xs ${
                  mediaHalfSet
                    ? "text-red-700 dark:text-red-400"
                    : "text-black/60 dark:text-white/60"
                }`}
              >
                {mediaHalfSet
                  ? "Set both the attachment type and the file link, or neither."
                  : "Must be a direct link — a Drive or Dropbox share page will not work."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!canSave || isSaving}
              className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
            >
              {isSaving ? "Saving…" : draft.id ? "Save Template" : "Create Template"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="min-h-11 rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {templates.length === 0 ? (
        <div className="rounded border border-black/15 px-4 py-8 text-center dark:border-white/20">
          <p className="mb-1 font-medium">No templates yet</p>
          <p className="text-sm text-black/60 dark:text-white/60">
            {canManage
              ? "Add one before anything can be sent to patients."
              : "Ask an admin to add one before you can message patients."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {templates.map((template) => (
            <li
              key={template.id}
              className="rounded border border-black/15 px-4 py-3 dark:border-white/20"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{template.name}</p>
                {template.mediaType && (
                  <span className="rounded bg-black/10 px-2 py-0.5 text-xs font-medium dark:bg-white/15">
                    {template.mediaType}
                  </span>
                )}
              </div>

              <p className="mt-1 whitespace-pre-wrap text-sm text-black/70 dark:text-white/70">
                {template.body}
              </p>

              {template.footer && (
                <p className="mt-1 text-xs text-black/55 dark:text-white/55">
                  {template.footer}
                </p>
              )}

              {canManage && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
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
                    className="min-h-11 rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
                  >
                    Edit Template
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(template.id)}
                    disabled={removingId === template.id}
                    className="min-h-11 rounded px-3 text-sm text-black/60 hover:bg-black/5 disabled:opacity-50 dark:text-white/60 dark:hover:bg-white/10"
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
