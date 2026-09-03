"use client";

import { useEffect, useState } from "react";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import type { SafeMediaAsset } from "@/lib/mediaTypes";
import { formatFileSize } from "@/components/messages/MediaPicker";

interface WhatsAppMediaPreviewProps {
  clinicMediaAsset?: SafeMediaAsset | null;
  legacyMediaType?: string | null;
  legacyMediaUrl?: string | null;
}

export default function WhatsAppMediaPreview({
  clinicMediaAsset,
  legacyMediaType,
  legacyMediaUrl,
}: WhatsAppMediaPreviewProps) {
  const [signedState, setSignedState] = useState<{
    assetId: string;
    url: string | null;
    error: string | null;
  } | null>(null);

  const assetId = clinicMediaAsset?.id ?? null;

  useEffect(() => {
    if (!assetId) {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/media/${assetId}/access-url`, {
      method: "POST",
      signal: controller.signal,
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.success || !payload.data?.url) {
          throw new Error(payload.error ?? "Media preview unavailable.");
        }
        setSignedState({
          assetId,
          url: payload.data.url as string,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSignedState({
          assetId,
          url: null,
          error: (err as Error).message || "Media preview unavailable.",
        });
      });

    return () => {
      controller.abort();
    };
  }, [assetId]);

  const currentSigned = assetId && signedState?.assetId === assetId ? signedState : null;
  const isLoading = Boolean(assetId && !currentSigned);
  const error = currentSigned?.error ?? null;
  const signedUrl = currentSigned?.url ?? null;

  // Priority 1: Clinic-specific uploaded MediaAsset
  if (clinicMediaAsset) {
    if (isLoading) {
      return (
        <div
          role="status"
          aria-label="Loading media preview"
          className="mb-3 flex h-36 w-full items-center justify-center rounded-xl bg-[#F0F2F5]/80 animate-pulse border border-black/5"
        >
          <div className="flex flex-col items-center gap-1.5 text-muted">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-micro font-medium">Loading preview…</span>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-xl bg-alert-bg/60 border border-alert-line/40 px-3 py-2 text-micro text-alert-ink"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-alert-ink" />
          <span className="truncate">{error}</span>
        </div>
      );
    }

    if (signedUrl) {
      if (clinicMediaAsset.mediaType === "IMAGE") {
        return (
          <div className="mb-3 overflow-hidden rounded-xl bg-black/5 border border-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signedUrl}
              alt={clinicMediaAsset.originalFileName}
              className="w-full max-h-[260px] rounded-xl object-cover"
              loading="lazy"
            />
          </div>
        );
      }

      if (clinicMediaAsset.mediaType === "VIDEO") {
        return (
          <div className="mb-3 overflow-hidden rounded-xl bg-black shadow-xs">
            <video
              src={signedUrl}
              controls
              preload="metadata"
              playsInline
              className="w-full max-h-[260px] rounded-xl"
            >
              Your browser does not support video playback.
            </video>
          </div>
        );
      }

      // DOCUMENT / PDF WhatsApp card
      return (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#D9DDE0] bg-[#F0F2F5] p-3 shadow-xs">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
            <FileText className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#111B21]">
              {clinicMediaAsset.originalFileName}
            </p>
            <p className="text-[11px] text-[#667781] font-medium mt-0.5">
              PDF · {formatFileSize(clinicMediaAsset.fileSize)}
            </p>
          </div>
        </div>
      );
    }

    return null;
  }

  // Priority 2: Legacy template mediaUrl + mediaType
  if (legacyMediaType && legacyMediaUrl) {
    const normType = legacyMediaType.toLowerCase();

    if (normType === "image") {
      return (
        <div className="mb-3 overflow-hidden rounded-xl bg-black/5 border border-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={legacyMediaUrl}
            alt="Template attachment"
            className="w-full max-h-[260px] rounded-xl object-cover"
            loading="lazy"
          />
        </div>
      );
    }

    if (normType === "video") {
      return (
        <div className="mb-3 overflow-hidden rounded-xl bg-black shadow-xs">
          <video
            src={legacyMediaUrl}
            controls
            preload="metadata"
            playsInline
            className="w-full max-h-[260px] rounded-xl"
          >
            Your browser does not support video playback.
          </video>
        </div>
      );
    }

    return (
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#D9DDE0] bg-[#F0F2F5] p-3 shadow-xs">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
          <FileText className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#111B21]">
            Document attachment
          </p>
          <p className="text-[11px] text-[#667781] font-medium mt-0.5 uppercase">
            {normType}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
