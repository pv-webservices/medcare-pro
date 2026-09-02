"use client";

import {
  ArrowDown,
  ArrowUp,
  CirclePlus,
  Hash,
  Info,
  PhoneCall,
  RotateCcw,
  Save,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { controlClasses, FieldShell } from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import StatusPill from "@/components/ui/StatusPill";
import Toggle from "@/components/ui/Toggle";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import type { ApiResponse } from "@/lib/utils";
import {
  CLINIC_IVR_BUSINESS_DIGITS,
  CLINIC_IVR_GREETING_MAX_LENGTH,
  CLINIC_IVR_LABEL_MAX_LENGTH,
  CLINIC_IVR_MENU_ACTIONS,
  PLIVO_SPEAK_LANGUAGES,
  PLIVO_SPEAK_LANGUAGE_VOICES,
  type ClinicIvrMenuActionValue,
  type PlivoSpeakLanguage,
  type PlivoSpeakVoice,
} from "@/lib/telephony/ivrProfileContract";
import {
  PHONE_MENU_ACTION_LABELS,
  PHONE_MENU_LANGUAGE_LABELS,
  PHONE_MENU_VOICE_LABELS,
  addPhoneMenuItem,
  buildPhoneMenuPreview,
  canAddPhoneMenuItem,
  changePhoneMenuLanguage,
  isPhoneMenuDraftDirty,
  movePhoneMenuItem,
  phoneMenuPutPayload,
  profileToPhoneMenuDraft,
  removePhoneMenuItem,
  updatePhoneMenuItem,
  validatePhoneMenuDraft,
  type PhoneMenuDraft,
  type PhoneMenuProfile,
} from "@/lib/telephony/phoneMenuEditor";

interface PhoneMenuEditorProps {
  clinicId: string;
  clinicName: string;
  initialProfile: PhoneMenuProfile;
}

type PendingAction = "save" | "reset" | null;

function apiErrorMessage(status: number, fallback?: string): string {
  if (status === 400) return fallback ?? "Check the highlighted phone menu fields.";
  if (status === 403) {
    return "You don't have permission to change this clinic's phone menu.";
  }
  return fallback ?? "The phone menu could not be saved. Try again.";
}

async function readProfileResponse(
  response: Response,
): Promise<ApiResponse<PhoneMenuProfile>> {
  return (await response.json()) as ApiResponse<PhoneMenuProfile>;
}

export default function PhoneMenuEditor({
  clinicId,
  clinicName,
  initialProfile,
}: PhoneMenuEditorProps) {
  const router = useRouter();
  const showToast = useToast();
  const greetingRef = useRef<HTMLTextAreaElement>(null);
  const [profile, setProfile] = useState(initialProfile);
  const [draft, setDraft] = useState<PhoneMenuDraft>(() =>
    profileToPhoneMenuDraft(initialProfile),
  );
  const [pending, setPending] = useState<PendingAction>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const validation = useMemo(() => validatePhoneMenuDraft(draft), [draft]);
  const preview = useMemo(
    () => buildPhoneMenuPreview(draft, clinicName),
    [clinicName, draft],
  );
  const dirty = isPhoneMenuDraftDirty(draft, profile);
  const isBusy = pending !== null;
  const usedDigits = new Set(draft.items.map((item) => item.digit));
  const usedActions = new Set(draft.items.map((item) => item.action));

  function hydrate(next: PhoneMenuProfile) {
    setProfile(next);
    setDraft(profileToPhoneMenuDraft(next));
  }

  function setGreeting(greetingTemplate: string) {
    setDraft((current) => ({ ...current, greetingTemplate }));
  }

  function insertClinicName() {
    const textarea = greetingRef.current;
    const start = textarea?.selectionStart ?? draft.greetingTemplate.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${draft.greetingTemplate.slice(0, start)}{clinicName}${draft.greetingTemplate.slice(end)}`;
    if (next.length > CLINIC_IVR_GREETING_MAX_LENGTH) return;
    setGreeting(next);
    requestAnimationFrame(() => {
      const cursor = start + "{clinicName}".length;
      greetingRef.current?.focus();
      greetingRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  async function save() {
    if (isBusy || !dirty || !validation.valid) return;
    const payload = phoneMenuPutPayload(draft);
    setPending("save");
    try {
      const response = await fetch(
        `/api/clinics/${encodeURIComponent(clinicId)}/telephony/ivr-profile`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            greetingTemplate: payload.greetingTemplate,
            language: payload.language,
            voice: payload.voice,
            items: payload.items,
          }),
        },
      );
      const body = await readProfileResponse(response);
      if (!response.ok || !body.success || !body.data) {
        showToast({
          tone: "alert",
          title: "Phone menu not saved",
          detail: apiErrorMessage(response.status, body.error),
        });
        return;
      }

      hydrate(body.data);
      showToast({ tone: "ok", title: "Phone menu saved." });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Phone menu not saved",
        detail: "Check your connection and try again. Your changes are still here.",
      });
    } finally {
      setPending(null);
    }
  }

  async function resetToDefault() {
    if (isBusy || profile.source !== "custom") return;
    setPending("reset");
    try {
      const response = await fetch(
        `/api/clinics/${encodeURIComponent(clinicId)}/telephony/ivr-profile`,
        { method: "DELETE" },
      );
      const body = await readProfileResponse(response);
      if (!response.ok || !body.success || !body.data) {
        showToast({
          tone: "alert",
          title: "Default menu not restored",
          detail: apiErrorMessage(response.status, body.error),
        });
        return;
      }

      hydrate(body.data);
      setResetOpen(false);
      showToast({ tone: "ok", title: "Default phone menu restored." });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Default menu not restored",
        detail: "Check your connection and try again. The custom menu is unchanged.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div aria-busy={isBusy || undefined} className="space-y-5">
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.75fr)] lg:items-start">
        <div className="min-w-0 space-y-5">
          <Panel
            title="Greeting"
            description="The first sentence callers hear when they reach the automated menu."
            actions={
              <StatusPill tone={profile.source === "custom" ? "accent" : "neutral"}>
                {profile.source === "custom" ? "Custom menu" : "Default menu"}
              </StatusPill>
            }
          >
            <FieldShell
              id="phone-menu-greeting"
              label="Greeting"
              error={validation.errors.greetingTemplate}
              hint={
                <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span>
                    Use <code className="font-semibold text-ink-soft">{"{clinicName}"}</code> to speak the selected clinic&apos;s current name.
                  </span>
                  <span aria-live="polite">
                    {draft.greetingTemplate.length}/{CLINIC_IVR_GREETING_MAX_LENGTH}
                  </span>
                </span>
              }
              labelAction={
                <button
                  type="button"
                  onClick={insertClinicName}
                  disabled={isBusy}
                  className="rounded-lg px-2 py-1 text-meta font-semibold text-accent hover:bg-accent-soft disabled:opacity-50"
                >
                  Insert clinic name
                </button>
              }
            >
              <textarea
                ref={greetingRef}
                id="phone-menu-greeting"
                rows={4}
                maxLength={CLINIC_IVR_GREETING_MAX_LENGTH}
                value={draft.greetingTemplate}
                disabled={isBusy}
                onChange={(event) => setGreeting(event.target.value)}
                aria-invalid={validation.errors.greetingTemplate ? true : undefined}
                aria-describedby="phone-menu-greeting-message"
                className={controlClasses(
                  Boolean(validation.errors.greetingTemplate),
                  "min-h-28 resize-y px-3.5 py-3 leading-relaxed",
                )}
              />
            </FieldShell>
          </Panel>

          <Panel
            title="Voice & language"
            description="Choose from the voices already supported by the phone menu."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id="phone-menu-language"
                label="Language"
                value={draft.language}
                disabled={isBusy}
                error={validation.errors.language}
                onChange={(event) =>
                  setDraft((current) =>
                    changePhoneMenuLanguage(
                      current,
                      event.target.value as PlivoSpeakLanguage,
                    ),
                  )
                }
              >
                {PLIVO_SPEAK_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {PHONE_MENU_LANGUAGE_LABELS[language]}
                  </option>
                ))}
              </Select>

              <Select
                id="phone-menu-voice"
                label="Voice"
                value={draft.voice}
                disabled={isBusy}
                error={validation.errors.voice}
                hint="Available voices depend on the selected language."
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    voice: event.target.value as PlivoSpeakVoice,
                  }))
                }
              >
                {PLIVO_SPEAK_LANGUAGE_VOICES[draft.language].map((voice) => (
                  <option key={voice} value={voice}>
                    {PHONE_MENU_VOICE_LABELS[voice]}
                  </option>
                ))}
              </Select>
            </div>
          </Panel>

          <Panel
            title="Keypad options"
            description="Digit chooses the action. Position chooses the order callers hear it."
            actions={
              <Button
                size="sm"
                variant="secondary"
                disabled={!canAddPhoneMenuItem(draft) || isBusy}
                onClick={() => setDraft((current) => addPhoneMenuItem(current))}
              >
                <CirclePlus aria-hidden="true" className="h-4 w-4" />
                Add option
              </Button>
            }
          >
            <div className="space-y-3">
              {draft.items.map((item, index) => {
                const labelError = validation.errors[`items.${index}.label`];
                return (
                  <article
                    key={item.action}
                    className={cx(
                      "rounded-2xl border p-4 transition-colors",
                      item.enabled
                        ? "border-line bg-canvas-deep/55"
                        : "border-dashed border-line-strong bg-canvas-deep/25",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
                      <Toggle
                        id={`phone-menu-enabled-${index}`}
                        label={`Option ${index + 1}`}
                        description={item.enabled ? "Callers can choose this option." : "Hidden from callers, but still editable."}
                        checked={item.enabled}
                        disabled={isBusy}
                        onChange={(enabled) =>
                          setDraft((current) =>
                            updatePhoneMenuItem(current, index, { enabled }),
                          )
                        }
                      />

                      <div className="flex items-center gap-1">
                        <IconButton
                          label={`Move option ${index + 1} up`}
                          isOutlined
                          disabled={index === 0 || isBusy}
                          onClick={() =>
                            setDraft((current) =>
                              movePhoneMenuItem(current, index, -1),
                            )
                          }
                        >
                          <ArrowUp aria-hidden="true" className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label={`Move option ${index + 1} down`}
                          isOutlined
                          disabled={index === draft.items.length - 1 || isBusy}
                          onClick={() =>
                            setDraft((current) =>
                              movePhoneMenuItem(current, index, 1),
                            )
                          }
                        >
                          <ArrowDown aria-hidden="true" className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </div>

                    <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.15fr)]">
                      <Select
                        id={`phone-menu-digit-${index}`}
                        label="Digit"
                        value={String(item.digit)}
                        disabled={isBusy}
                        icon={<Hash className="h-4 w-4" />}
                        onChange={(event) =>
                          setDraft((current) =>
                            updatePhoneMenuItem(current, index, {
                              digit: Number(event.target.value),
                            }),
                          )
                        }
                      >
                        {CLINIC_IVR_BUSINESS_DIGITS.map((digit) => (
                          <option
                            key={digit}
                            value={digit}
                            disabled={digit !== item.digit && usedDigits.has(digit)}
                          >
                            {digit}
                          </option>
                        ))}
                      </Select>

                      <Select
                        id={`phone-menu-action-${index}`}
                        label="Action"
                        value={item.action}
                        disabled={isBusy}
                        onChange={(event) =>
                          setDraft((current) =>
                            updatePhoneMenuItem(current, index, {
                              action: event.target.value as ClinicIvrMenuActionValue,
                            }),
                          )
                        }
                      >
                        {CLINIC_IVR_MENU_ACTIONS.map((action) => (
                          <option
                            key={action}
                            value={action}
                            disabled={action !== item.action && usedActions.has(action)}
                          >
                            {PHONE_MENU_ACTION_LABELS[action]}
                          </option>
                        ))}
                      </Select>

                      <FieldShell
                        id={`phone-menu-label-${index}`}
                        label="Caller-facing label"
                        error={labelError}
                        hint={`${item.label.length}/${CLINIC_IVR_LABEL_MAX_LENGTH} characters`}
                        className="sm:col-span-2 xl:col-span-1"
                      >
                        <input
                          id={`phone-menu-label-${index}`}
                          value={item.label}
                          maxLength={CLINIC_IVR_LABEL_MAX_LENGTH}
                          disabled={isBusy}
                          onChange={(event) =>
                            setDraft((current) =>
                              updatePhoneMenuItem(current, index, {
                                label: event.target.value,
                              }),
                            )
                          }
                          aria-invalid={labelError ? true : undefined}
                          aria-describedby={`phone-menu-label-${index}-message`}
                          className={controlClasses(Boolean(labelError), "min-h-11 px-3.5")}
                        />
                      </FieldShell>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-meta text-muted">
                        Spoken position {index + 1} · keypad {item.digit}
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={draft.items.length === 1 || isBusy}
                        onClick={() =>
                          setDraft((current) =>
                            removePhoneMenuItem(current, index),
                          )
                        }
                      >
                        Remove option
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>

            {validation.formError && (
              <div role="alert" className="mt-4 rounded-xl border border-alert-line bg-alert-bg px-4 py-3 text-label font-medium text-alert-ink">
                {validation.formError}
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-line bg-canvas-deep p-4">
              <div className="flex items-center gap-2 text-label font-semibold text-ink-soft">
                <Info aria-hidden="true" className="h-4 w-4 text-accent" />
                System controls
              </div>
              <dl className="mt-3 grid gap-3 text-label sm:grid-cols-2">
                <div className="flex gap-3">
                  <dt className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas font-bold text-ink">8</dt>
                  <dd className="pt-1 text-muted">Reserved for more options inside longer menus.</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas font-bold text-ink">9</dt>
                  <dd className="pt-1 text-muted">Repeat or return to the main menu.</dd>
                </div>
              </dl>
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-24">
          <section className="overflow-hidden rounded-3xl border border-line bg-[linear-gradient(155deg,var(--color-canvas)_0%,var(--color-canvas-deep)_100%)] shadow-card">
            <div className="border-b border-line px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-meta font-semibold uppercase tracking-[0.14em] text-accent">
                    <Volume2 aria-hidden="true" className="h-4 w-4" />
                    Text preview
                  </p>
                  <h2 className="mt-2 text-section font-semibold text-ink">Caller hears</h2>
                </div>
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <PhoneCall className="h-5 w-5" />
                </span>
              </div>
              <p className="mt-2 text-label text-muted">
                A live preview of this unsaved draft. No call or audio is generated.
              </p>
            </div>

            <div className="px-5 py-6">
              <div className="relative border-l-2 border-accent-soft pl-5">
                <span aria-hidden="true" className="absolute -left-[7px] top-0 h-3 w-3 rounded-full border-2 border-canvas bg-accent" />
                <p className="text-body font-semibold leading-relaxed text-ink">
                  {preview.greeting || "Your greeting will appear here."}
                </p>

                <div className="mt-5 space-y-3">
                  {preview.options.map((option, index) => (
                    <div key={`${option}-${index}`} className="flex items-start gap-3">
                      <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-meta font-bold text-accent">
                        {draft.items.filter((item) => item.enabled)[index]?.digit}
                      </span>
                      <p className="pt-1 text-label leading-relaxed text-ink-soft">{option}</p>
                    </div>
                  ))}
                  {preview.options.length === 0 && (
                    <p className="text-label text-alert-ink">Enable at least one option to complete the menu.</p>
                  )}
                </div>

                <div className="mt-5 flex items-start gap-3 border-t border-line pt-4">
                  <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-canvas text-meta font-bold text-ink shadow-card">9</span>
                  <p className="pt-1 text-label leading-relaxed text-muted">{preview.repeat}</p>
                </div>
              </div>
            </div>
          </section>

          <Panel
            title={profile.source === "custom" ? "Customized for this clinic" : "MEDCARE PRO default"}
            description={
              profile.source === "custom"
                ? "This clinic has a customized phone menu."
                : "Save changes to create a custom menu for this clinic."
            }
          >
            <div className="space-y-3 text-label text-muted">
              <p>
                This menu is used whenever call handling sends callers to the automated IVR.
              </p>
              <p className="flex items-start gap-2 rounded-xl bg-canvas-deep px-3 py-2.5">
                <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                Routing between Auto, Reception, and IVR stays in Dashboard Call Handling.
              </p>
            </div>
          </Panel>
        </aside>
      </div>

      <div className="flex flex-col-reverse gap-3 rounded-2xl border border-line bg-canvas p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-label font-semibold text-ink">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </p>
          <p className="mt-0.5 text-meta text-muted">
            Saving updates the complete menu used the next time callers enter IVR.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {profile.source === "custom" && (
            <Button
              variant="danger"
              disabled={isBusy}
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Reset to default
            </Button>
          )}
          <Button
            variant="primary"
            isBusy={pending === "save"}
            busyLabel="Saving phone menu"
            disabled={!dirty || !validation.valid || isBusy}
            onClick={save}
          >
            <Save aria-hidden="true" className="h-4 w-4" />
            Save phone menu
          </Button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={resetOpen}
        onCancel={() => setResetOpen(false)}
        onConfirm={resetToDefault}
        title="Reset phone menu to default?"
        confirmLabel="Reset to default"
        isBusy={pending === "reset"}
        busyLabel="Restoring default"
        body={
          <span>
            The custom greeting and keypad menu will be removed, and the MEDCARE PRO default phone menu will be used whenever calls enter IVR. This does not disable telephony or change Auto, Reception, or IVR routing.
          </span>
        }
      />
    </div>
  );
}
