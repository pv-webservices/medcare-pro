"use client";

import {
  Pencil,
  Plus,
  Upload,
  FolderOpen,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  AlertCircle,
  Loader2,
  X,
  ExternalLink,
} from "lucide-react";
import { useState, useRef, type FormEvent, type DragEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { MEDIA_TYPES } from "@/lib/whatsapp";
import {
  PLACEHOLDER_LABELS,
  TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders,
} from "@/lib/whatsappTemplateText";
import type { TemplateRecord } from "@/lib/whatsappTemplates";
import type { SafeMediaAsset } from "@/lib/mediaTypes";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import MediaPicker, { formatFileSize } from "@/components/messages/MediaPicker";

interface TemplateManagerProps {
  templates: readonly TemplateRecord[];
  canManage: boolean;
  clinicId?: string | null;
  clinicName?: string | null;
}

interface DraftState {
  id: string | null;
  name: string;
  body: string;
  footer: string;
  mediaType: string;
  mediaUrl: string;
  mediaAsset: SafeMediaAsset | null;
  originalMediaAssetId: string | null;
  showLegacyMediaUrl: boolean;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  name: "",
  body: "",
  footer: "",
  mediaType: "",
  mediaUrl: "",
  mediaAsset: null,
  originalMediaAssetId: null,
  showLegacyMediaUrl: false,
};

export default function TemplateManager({
  templates,
  canManage,
  clinicId,
  clinicName,
}: TemplateManagerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);

  // Preview modal state
  const [previewingAsset, setPreviewingAsset] = useState<SafeMediaAsset | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const badTokens = draft ? unknownPlaceholders(draft.body) : [];
  const mediaHalfSet =
    draft && draft.showLegacyMediaUrl
      ? Boolean(draft.mediaType) !== Boolean(draft.mediaUrl)
      : false;

  const canSave =
    draft !== null &&
    draft.name.trim() !== "" &&
    draft.body.trim() !== "" &&
    badTokens.length === 0 &&
    !mediaHalfSet &&
    !isUploading;

  async function handleFileSelected(file: File) {
    if (!clinicId) {
      setUploadError("Please select a clinic before uploading media.");
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clinicId", clinicId);

      const res = await fetch(`/api/media?clinicId=${encodeURIComponent(clinicId)}`, {
        method: "POST",
        body: formData,
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to upload file.");
      }

      setDraft((current) =>
        current ? { ...current, mediaAsset: payload.data as SafeMediaAsset } : current,
      );
    } catch (err: unknown) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  }

  async function openPreview(asset: SafeMediaAsset) {
    setPreviewingAsset(asset);
    setPreviewUrl(null);
    setIsLoadingPreview(true);
    setPreviewError(null);

    try {
      const res = await fetch(`/api/media/${asset.id}/access-url`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success || !payload.data?.url) {
        if (res.status === 404) {
          throw new Error("That file could not be found.");
        }
        if (res.status === 503) {
          throw new Error("Media preview is temporarily unavailable.");
        }
        throw new Error(payload.error ?? "Media preview is temporarily unavailable.");
      }
      setPreviewUrl(payload.data.url as string);
    } catch (err: unknown) {
      setPreviewError((err as Error).message);
    } finally {
      setIsLoadingPreview(false);
    }
  }

  function closePreview() {
    setPreviewingAsset(null);
    setPreviewUrl(null);
    setPreviewError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canSave) return;

    setIsSaving(true);
    setError(null);

    try {
      const payload = {
        name: draft.name,
        body: draft.body,
        footer: draft.footer,
        mediaType: draft.showLegacyMediaUrl ? draft.mediaType : "",
        mediaUrl: draft.showLegacyMediaUrl ? draft.mediaUrl : "",
      };

      let savedTemplateId = draft.id;

      if (draft.id) {
        // Update template
        const res = await fetch("/api/whatsapp/templates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: draft.id, ...payload }),
        });
        const resJson = await res.json().catch(() => ({}));
        if (!res.ok || !resJson.success) {
          throw new Error(resJson.error ?? "Could not update template.");
        }
      } else {
        // Create template
        const res = await fetch("/api/whatsapp/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const resJson = await res.json().catch(() => ({}));
        if (!res.ok || !resJson.success) {
          throw new Error(resJson.error ?? "Could not create template.");
        }
        savedTemplateId = resJson.data.id;
      }

      // Handle clinic-specific media binding
      if (clinicId && savedTemplateId) {
        if (draft.mediaAsset) {
          // Bind media asset
          const bindRes = await fetch(
            `/api/whatsapp/templates/${savedTemplateId}/media`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clinicId,
                mediaAssetId: draft.mediaAsset.id,
              }),
            },
          );
          const bindJson = await bindRes.json().catch(() => ({}));
          if (!bindRes.ok || !bindJson.success) {
            throw new Error(bindJson.error ?? "Could not bind template media.");
          }
        } else if (draft.originalMediaAssetId && !draft.mediaAsset) {
          // Removed attachment
          await fetch(
            `/api/whatsapp/templates/${savedTemplateId}/media?clinicId=${encodeURIComponent(clinicId)}`,
            { method: "DELETE" },
          );
        }
      }

      setDraft(null);
      router.refresh();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(templateId: string) {
    setRemovingId(templateId);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? "Could not remove template.");
      }
      router.refresh();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  function insertPlaceholder(token: string) {
    setDraft((current) =>
      current === null ? current : { ...current, body: `${current.body}{${token}}` },
    );
  }

  function renderMediaIcon(type?: string) {
    switch (type) {
      case "IMAGE":
      case "image":
        return <ImageIcon className="h-5 w-5 text-accent" />;
      case "VIDEO":
      case "video":
        return <Film className="h-5 w-5 text-sky-500" />;
      case "DOCUMENT":
      case "document":
        return <FileText className="h-5 w-5 text-amber-500" />;
      default:
        return <FileText className="h-5 w-5 text-muted" />;
    }
  }

  return (
    <section aria-labelledby="templates-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="templates-heading" className="text-lg font-bold tracking-tight text-ink">
            Message templates
          </h2>
          <p className="mt-0.5 text-label text-muted">
            {clinicName ? (
              <>
                Active clinic: <span className="font-semibold text-ink">{clinicName}</span>.
                Attachments are saved specifically for this clinic.
              </>
            ) : (
              "MedCarePro sends saved templates only in this workflow."
            )}
          </p>
        </div>
        {canManage && draft === null && (
          <Button
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
            variant="primary"
            className="rounded-xl px-4 py-2 font-semibold text-body shadow-cta flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add template
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.mp4,.pdf"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {draft && (
        <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card mb-6">
          <h3 className="text-base font-bold text-ink mb-4">
            {draft.id ? "Edit template" : "New template"}
          </h3>
          <form onSubmit={handleSubmit} className="grid gap-6">
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
              <label
                htmlFor="template-body"
                className="mb-1.5 block text-label font-semibold text-ink"
              >
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
                className={`block w-full rounded-xl border bg-canvas px-3.5 py-2.5 text-body outline-none transition-colors ${
                  badTokens.length > 0
                    ? "border-alert-line focus:border-alert-line"
                    : "border-line focus:border-accent"
                }`}
              />
              <p
                id="template-body-help"
                className={`mt-2 text-micro ${
                  badTokens.length > 0 ? "text-alert-ink" : "text-muted"
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
                      className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-micro font-medium text-ink shadow-sm hover:bg-canvas-deep transition-colors"
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
                placeholder="e.g. Sent by Sharma Clinic"
              />
            </div>

            {/* Media Section */}
            <div className="rounded-2xl border border-line bg-canvas-deep/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-body font-bold text-ink">
                    Media Attachment
                  </h4>
                  <p className="text-micro text-muted">
                    {clinicName
                      ? `Attached media for ${clinicName}. Stored securely on private storage.`
                      : "Attach an image, video, or PDF document."}
                  </p>
                </div>
              </div>

              {!clinicId ? (
                <div className="rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-label text-warn-ink flex items-start gap-2.5">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Clinic selection required</p>
                    <p className="mt-0.5 text-micro">
                      Media is clinic-scoped. Please select a specific clinic from the top-left switcher to upload or attach media for this template.
                    </p>
                  </div>
                </div>
              ) : draft.mediaAsset ? (
                /* Selected Media Card */
                <div className="rounded-xl border border-line bg-canvas p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-[200px]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-canvas-deep border border-line">
                      {renderMediaIcon(draft.mediaAsset.mediaType)}
                    </div>
                    <div>
                      <p
                        className="text-body font-semibold text-ink line-clamp-1 max-w-xs break-all"
                        title={draft.mediaAsset.originalFileName}
                      >
                        {draft.mediaAsset.originalFileName}
                      </p>
                      <p className="text-micro text-muted mt-0.5">
                        {draft.mediaAsset.mediaType} · {formatFileSize(draft.mediaAsset.fileSize)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => openPreview(draft.mediaAsset!)}
                      className="rounded-xl px-3 py-1.5 text-label flex items-center gap-1.5"
                    >
                      <Eye className="h-4 w-4 text-muted" />
                      Preview
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-xl px-3 py-1.5 text-label"
                    >
                      Replace
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setDraft({ ...draft, mediaAsset: null })
                      }
                      className="rounded-xl px-3 py-1.5 text-label text-alert-ink hover:text-alert-ink"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                /* Empty Upload / Dropzone */
                <div className="space-y-3">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                      isDragOver
                        ? "border-accent bg-accent/5"
                        : "border-line bg-canvas hover:border-muted hover:bg-canvas-deep/20"
                    }`}
                  >
                    {isUploading ? (
                      <div className="flex flex-col items-center gap-2 py-4">
                        <Loader2 className="h-8 w-8 animate-spin text-accent" />
                        <p className="text-body font-semibold text-ink">
                          Uploading and verifying file…
                        </p>
                        <p className="text-micro text-muted">
                          Checking file signature and storing securely
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas-deep border border-line mb-3">
                          <Upload className="h-5 w-5 text-muted" />
                        </div>
                        <p className="text-body font-semibold text-ink">
                          Drag and drop file here, or choose an option below
                        </p>
                        <p className="text-micro text-muted mt-1">
                          JPG, PNG, WebP, MP4, PDF (max 50 MB)
                        </p>

                        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-xl px-4 py-2 text-label font-semibold flex items-center gap-1.5"
                          >
                            <Upload className="h-4 w-4" />
                            Upload from computer
                          </Button>

                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setIsMediaPickerOpen(true)}
                            className="rounded-xl px-4 py-2 text-label font-semibold flex items-center gap-1.5"
                          >
                            <FolderOpen className="h-4 w-4 text-muted" />
                            Media library
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  {uploadError && (
                    <p role="alert" className="text-micro text-alert-ink font-medium">
                      {uploadError}
                    </p>
                  )}
                </div>
              )}

              {/* Legacy URL entry collapsed under Advanced */}
              <div className="pt-2 border-t border-line/60">
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      showLegacyMediaUrl: !draft.showLegacyMediaUrl,
                    })
                  }
                  className="text-micro font-medium text-muted hover:text-ink transition-colors flex items-center gap-1"
                >
                  <span>{draft.showLegacyMediaUrl ? "Hide" : "Advanced:"} Use external media URL (legacy)</span>
                </button>

                {draft.showLegacyMediaUrl && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr] animate-in fade-in duration-150">
                    <div>
                      <Select
                        id="template-media-type"
                        name="mediaType"
                        label="Legacy type"
                        value={draft.mediaType}
                        onChange={(event) =>
                          setDraft({ ...draft, mediaType: event.target.value })
                        }
                      >
                        <option value="">None</option>
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
                        label="External URL"
                        type="url"
                        value={draft.mediaUrl}
                        onChange={(event) =>
                          setDraft({ ...draft, mediaUrl: event.target.value })
                        }
                        maxLength={2000}
                        placeholder="https://example.com/leaflet.pdf"
                        error={
                          mediaHalfSet
                            ? "Set both the attachment type and the file link, or neither."
                            : undefined
                        }
                        hint={
                          !mediaHalfSet
                            ? "Must be a direct link — a Drive or Dropbox share page will not work."
                            : undefined
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                type="submit"
                disabled={!canSave || isSaving}
                variant="primary"
                isBusy={isSaving}
                busyLabel="Saving…"
                className="rounded-xl px-4 py-2 font-semibold"
              >
                {draft.id ? "Save template" : "Create template"}
              </Button>
              <Button
                type="button"
                onClick={() => setDraft(null)}
                variant="secondary"
                className="rounded-xl px-4 py-2"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates.map((tmpl) => {
            const hasClinicMedia = Boolean(tmpl.clinicMediaAsset);
            const hasLegacyMedia = Boolean(tmpl.mediaType && tmpl.mediaUrl);

            return (
              <div
                key={tmpl.id}
                className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card flex flex-col justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                    <h3 className="text-body font-bold text-ink">{tmpl.name}</h3>

                    {hasClinicMedia && tmpl.clinicMediaAsset ? (
                      <div className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/20 px-2 py-0.5 text-micro font-medium text-accent">
                        {renderMediaIcon(tmpl.clinicMediaAsset.mediaType)}
                        <span className="truncate max-w-[140px]">
                          {tmpl.clinicMediaAsset.originalFileName}
                        </span>
                        <button
                          type="button"
                          onClick={() => openPreview(tmpl.clinicMediaAsset!)}
                          title="Preview media"
                          className="ml-0.5 hover:text-accent/80"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                      </div>
                    ) : hasLegacyMedia ? (
                      <span className="rounded-lg bg-canvas-deep px-2 py-0.5 text-micro font-medium text-muted">
                        {tmpl.mediaType} (external)
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-2xl bg-canvas-deep/40 border border-line/60 p-4 min-h-[140px] flex flex-col justify-between">
                    <p className="whitespace-pre-wrap text-label text-ink leading-relaxed break-words font-normal">
                      {tmpl.body}
                    </p>

                    <div className="mt-4 pt-2 text-micro font-medium text-muted">
                      {clinicName ?? "All clinics"}
                    </div>
                  </div>

                  {tmpl.footer && (
                    <p className="mt-2 text-meta text-muted italic">
                      {tmpl.footer}
                    </p>
                  )}
                </div>

                {canManage && (
                  <div className="mt-5 flex items-center gap-3 pt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          id: tmpl.id,
                          name: tmpl.name,
                          body: tmpl.body,
                          footer: tmpl.footer ?? "",
                          mediaType: tmpl.mediaType ?? "",
                          mediaUrl: tmpl.mediaUrl ?? "",
                          mediaAsset: tmpl.clinicMediaAsset ?? null,
                          originalMediaAssetId: tmpl.clinicMediaAsset?.id ?? null,
                          showLegacyMediaUrl: Boolean(tmpl.mediaUrl),
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 py-1.5 text-label font-semibold text-ink shadow-sm hover:bg-canvas-deep transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                      Edit template
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(tmpl.id)}
                      disabled={removingId === tmpl.id}
                      className="text-label font-semibold text-accent hover:underline disabled:opacity-50 transition-colors px-2 py-1"
                    >
                      {removingId === tmpl.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Media Picker Modal */}
      {clinicId && (
        <MediaPicker
          clinicId={clinicId}
          clinicName={clinicName ?? "Selected Clinic"}
          isOpen={isMediaPickerOpen}
          onClose={() => setIsMediaPickerOpen(false)}
          onSelect={(asset) => {
            setDraft((current) =>
              current ? { ...current, mediaAsset: asset } : current,
            );
          }}
          selectedAssetId={draft?.mediaAsset?.id}
        />
      )}

      {/* Media Preview Modal */}
      {previewingAsset && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-line bg-canvas shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div>
                <h3 id="preview-title" className="text-body font-bold text-ink">
                  {previewingAsset.originalFileName}
                </h3>
                <p className="text-micro text-muted">
                  {previewingAsset.mediaType} · {formatFileSize(previewingAsset.fileSize)}
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="rounded-xl p-2 text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-1 items-center justify-center p-6 bg-canvas-deep/40 min-h-[300px] overflow-auto">
              {isLoadingPreview ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-accent" />
                  <p className="text-label text-muted">Loading preview…</p>
                </div>
              ) : previewError ? (
                <div className="flex flex-col items-center gap-3 p-6 text-center max-w-md">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-alert-bg text-alert-ink">
                    <AlertCircle className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-body font-semibold text-ink">Preview Unavailable</p>
                    <p className="text-label text-muted mt-1">{previewError}</p>
                  </div>
                </div>
              ) : previewUrl ? (
                previewingAsset.mediaType === "IMAGE" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={previewingAsset.originalFileName}
                    className="max-h-[60vh] max-w-full rounded-xl object-contain shadow-md"
                  />
                ) : previewingAsset.mediaType === "VIDEO" ? (
                  <video
                    src={previewUrl}
                    controls
                    autoPlay
                    className="max-h-[60vh] max-w-full rounded-xl shadow-md"
                  >
                    Your browser does not support video playback.
                  </video>
                ) : (
                  <div className="flex flex-col items-center gap-4 text-center p-6 bg-canvas rounded-2xl border border-line shadow-xs">
                    <FileText className="h-16 w-16 text-amber-500" />
                    <div>
                      <p className="text-body font-semibold text-ink">PDF Document</p>
                      <p className="text-label text-muted mt-1">{previewingAsset.originalFileName}</p>
                    </div>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-label font-semibold text-white shadow-cta hover:bg-accent/90"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open PDF in new tab
                    </a>
                  </div>
                )
              ) : null}
            </div>

            <div className="flex justify-end border-t border-line px-6 py-3 bg-canvas-deep/20">
              <Button variant="secondary" onClick={closePreview}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
