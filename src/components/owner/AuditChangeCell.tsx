"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface AuditChangeCellProps {
  beforeValue: unknown;
  afterValue: unknown;
}

function previewJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = JSON.stringify(value);
  return text.length > 34 ? `${text.slice(0, 31)}...` : text;
}

export default function AuditChangeCell({
  beforeValue,
  afterValue,
}: AuditChangeCellProps) {
  const [copied, setCopied] = useState(false);

  const rawValue = afterValue ?? beforeValue;
  if (rawValue === null || rawValue === undefined) {
    return <span className="text-slate-600 font-medium">&mdash;</span>;
  }

  const fullJson = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue, null, 2);
  const previewText = previewJson(rawValue);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Swallowed clipboard error
    }
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800/80 bg-[#090e23]/90 px-2.5 py-1 font-mono text-[11px] text-emerald-400/90 shadow-xs max-w-[240px]">
      <span className="truncate" title={fullJson}>
        {previewText}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copied to clipboard" : "Copy full payload"}
        aria-label="Copy JSON payload"
        className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors p-0.5"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
