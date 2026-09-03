"use client";

import { useEffect, useState } from "react";
import {
  FileText,
  Film,
  Image as ImageIcon,
  Search,
  X,
  Check,
  Loader2,
} from "lucide-react";
import type { SafeMediaAsset, StoredMediaType } from "@/lib/mediaTypes";
import Button from "@/components/ui/Button";

interface MediaPickerProps {
  clinicId: string;
  clinicName: string;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (asset: SafeMediaAsset) => void;
  selectedAssetId?: string | null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaPicker({
  clinicId,
  clinicName,
  isOpen,
  onClose,
  onSelect,
  selectedAssetId,
}: MediaPickerProps) {
  const [assets, setAssets] = useState<SafeMediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"ALL" | StoredMediaType>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    queueMicrotask(() => {
      if (ignore) return;
      setLoading(true);
      setError(null);
    });

    const query = new URLSearchParams({ clinicId });
    if (filterType !== "ALL") {
      query.set("mediaType", filterType);
    }

    fetch(`/api/media?${query.toString()}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.success) {
          throw new Error(payload.error ?? "Failed to load media assets.");
        }
        if (!ignore) {
          setAssets(payload.data ?? []);
        }
      })
      .catch((err: Error) => {
        if (!ignore) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [isOpen, clinicId, filterType]);

  if (!isOpen) return null;

  const filteredAssets = assets.filter((asset) =>
    asset.originalFileName.toLowerCase().includes(searchQuery.toLowerCase().trim()),
  );

  function getMediaIcon(type: StoredMediaType) {
    switch (type) {
      case "IMAGE":
        return <ImageIcon className="h-6 w-6 text-accent" />;
      case "VIDEO":
        return <Film className="h-6 w-6 text-sky-500" />;
      case "DOCUMENT":
        return <FileText className="h-6 w-6 text-amber-500" />;
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
    >
      <div className="flex h-[90vh] max-h-[700px] w-full max-w-3xl flex-col rounded-3xl border border-line bg-canvas shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 id="media-picker-title" className="text-base font-bold text-ink">
              Media Library
            </h2>
            <p className="text-label text-muted">
              Files uploaded for <span className="font-semibold text-ink">{clinicName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-xl p-2 text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar / Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3 bg-canvas-deep/30">
          <div className="flex items-center gap-1.5 rounded-xl border border-line bg-canvas p-1">
            {(["ALL", "IMAGE", "VIDEO", "DOCUMENT"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFilterType(type)}
                className={`rounded-lg px-3 py-1 text-micro font-medium transition-colors ${
                  filterType === type
                    ? "bg-accent text-white font-semibold shadow-xs"
                    : "text-muted hover:text-ink hover:bg-canvas-deep"
                }`}
              >
                {type === "ALL"
                  ? "All"
                  : type === "IMAGE"
                    ? "Images"
                    : type === "VIDEO"
                      ? "Videos"
                      : "Documents"}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted pointer-events-none" />
            <input
              type="search"
              placeholder="Search by filename…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-line bg-canvas pl-9 pr-3.5 py-1.5 text-body text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <p className="text-body font-medium">Loading media library…</p>
            </div>
          ) : error ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
              <p className="text-body font-medium text-alert-ink">{error}</p>
              <Button variant="secondary" onClick={() => setFilterType(filterType)}>
                Try again
              </Button>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
              <p className="text-body font-medium text-ink">No media found</p>
              <p className="text-label text-muted max-w-sm">
                {searchQuery
                  ? "No files match your search criteria."
                  : "No files have been uploaded for this clinic yet."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {filteredAssets.map((asset) => {
                const isSelected = asset.id === selectedAssetId;
                const formattedDate = new Date(asset.createdAt).toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric", year: "numeric" },
                );

                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      onSelect(asset);
                      onClose();
                    }}
                    className={`group relative flex flex-col justify-between rounded-2xl border p-4 text-left transition-all hover:shadow-md ${
                      isSelected
                        ? "border-accent bg-accent/5 ring-2 ring-accent/20"
                        : "border-line bg-canvas hover:border-line hover:bg-canvas-deep/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="rounded-xl border border-line/80 bg-canvas p-2.5 shadow-xs">
                        {getMediaIcon(asset.mediaType)}
                      </div>
                      {isSelected && (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>

                    <div>
                      <p
                        className="text-body font-semibold text-ink line-clamp-1 break-all"
                        title={asset.originalFileName}
                      >
                        {asset.originalFileName}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-micro text-muted">
                        <span>{asset.mediaType}</span>
                        <span>·</span>
                        <span>{formatFileSize(asset.fileSize)}</span>
                      </div>
                      <p className="mt-1 text-micro text-muted">{formattedDate}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-line px-6 py-3 bg-canvas-deep/20">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
