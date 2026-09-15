"use client";
import { useEffect, useState } from "react";
import { audioRequest } from "@/components/clinicalAudio/useClinicalRecorder";
export default function ClinicalAiSettings({ canManage }: { canManage: boolean }) {
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; void audioRequest<{ allowGeminiTranscriptionFallback: boolean }>("/api/settings/clinical-ai").then(r => { if (live) { setAllowed(r.allowGeminiTranscriptionFallback); setReady(true); } }).catch(() => { if (live) setError("Clinical AI settings are unavailable."); }); return () => { live = false; }; }, []);
  async function change(value: boolean) { setReady(false); setError(""); try { await audioRequest("/api/settings/clinical-ai", { allowed: value }); setAllowed(value); } catch { setError("Unable to save Clinical AI settings."); } finally { setReady(true); } }
  return <section className="space-y-3 rounded-xl border border-line p-4" aria-label="Clinical AI settings"><h3 className="font-semibold">Clinical AI</h3><p>Primary transcription provider: Sarvam AI</p><p>Backup transcription provider: Gemini</p><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={allowed} disabled={!ready || !canManage} onChange={e => void change(e.target.checked)} />Allow Gemini as a backup transcription processor</label><p className="text-sm text-muted">When enabled, an authorized clinician may send a failed Sarvam recording to Gemini for a second transcription attempt.</p>{error && <p role="alert">{error}</p>}</section>;
}
