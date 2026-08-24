"use client";

import { useEffect } from "react";

/**
 * The last boundary. Catches a throw from the ROOT layout itself — the one
 * place src/app/error.tsx cannot reach, because that boundary renders inside
 * the very layout that failed.
 *
 * It replaces the entire document, which is why it ships its own <html> and
 * <body>. It is also why everything here is INLINE STYLE rather than a Tailwind
 * class or a design token: globals.css is imported by the root layout, so in the
 * exact situation this file exists for, the stylesheet may never have been
 * applied. A boundary that depends on the thing it is catching is not a
 * boundary. The result is plainer than the rest of the app on purpose — it has
 * to render with no CSS, no fonts and no providers.
 *
 * Colours are hard-coded for the same reason and are deliberately theme-neutral:
 * the ThemeProvider is gone too, so there is no light/dark answer to honour.
 */

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error }: GlobalErrorProps) {
  /**
   * Full reload for the same reason as src/app/error.tsx: `reset()` re-renders
   * from a cache that still holds the failure. At this level the root layout
   * itself threw, so rebuilding the document is the only recovery that does not
   * depend on something that may be broken.
   */
  function handleRetry() {
    window.location.reload();
  }

  useEffect(() => {
    console.error("Root layout failed to render", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#eef1f6",
          color: "#1f2933",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <main
          style={{
            maxWidth: "34rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0 }}>
            MedCare Pro could not start
          </h1>

          <p
            style={{
              marginTop: "0.75rem",
              lineHeight: 1.6,
              color: "#52606d",
            }}
          >
            A fault stopped the application from loading. No data has been lost.
            If this keeps happening, contact support with the reference below.
          </p>

          {error.digest && (
            <p
              style={{
                marginTop: "1rem",
                fontSize: "0.875rem",
                color: "#7b8794",
              }}
            >
              Reference: <strong>{error.digest}</strong>
            </p>
          )}

          <button
            type="button"
            onClick={handleRetry}
            style={{
              marginTop: "1.5rem",
              minHeight: "44px",
              padding: "0 1.5rem",
              borderRadius: "14px",
              border: "none",
              backgroundColor: "#0f766e",
              color: "#ffffff",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
