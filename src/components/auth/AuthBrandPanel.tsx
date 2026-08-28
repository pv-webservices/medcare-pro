import AuthBrandMark from "@/components/auth/AuthBrandMark";
import AuthProductPreview from "@/components/auth/AuthProductPreview";

/**
 * The branded half of the authentication layout.
 *
 * IT IS THE QUIETER HALF. The form is what the visitor came to use, so this
 * panel never out-shouts it: no photograph, no headline larger than the form's,
 * no saturated fill. It is a pale lavender wash, a sentence about what the
 * product does, and a reduced drawing of the workspace.
 *
 * HIDDEN BELOW `lg` ENTIRELY. On a phone it would push the form below the fold,
 * which is the one thing an auth screen must never do. It is not "simplified"
 * for small screens — it is removed, and the mobile header carries the brand
 * instead.
 *
 * A server component: it holds no state and ships no JavaScript.
 */
export default function AuthBrandPanel() {
  // NOTE: no `overflow-hidden` on the <aside>. It would make that element the
  // scroll container for the sticky column inside it, and the panel would
  // scroll away with a long form instead of holding its place.
  return (
    <aside className="relative hidden shrink-0 border-r border-auth-line bg-auth-bg lg:flex lg:w-[42%] lg:max-w-[620px] lg:flex-col">
      {/*
        The whole decorative treatment: two very wide, very soft radial washes.
        Not a gradient panel — at these opacities it reads as light in a room
        rather than as a coloured background.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(60% 45% at 12% 8%, rgb(109 93 251 / 0.10) 0%, transparent 60%), radial-gradient(55% 40% at 92% 78%, rgb(109 93 251 / 0.08) 0%, transparent 62%)",
        }}
      />

      {/* Sticky so the panel stays in place while a long form (signup) scrolls. */}
      <div className="sticky top-0 flex h-screen flex-col justify-between p-10 xl:p-14">
        <AuthBrandMark showTagline />

        <div className="py-10">
          <h2 className="max-w-[17ch] text-[32px] font-semibold leading-[1.18] tracking-[-0.02em] text-auth-ink xl:text-[36px]">
            Modern clinic management, without the administrative clutter.
          </h2>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-auth-ink-soft">
            Manage patients, clinics, doctors, registrations and operations from
            one secure workspace.
          </p>

          {/*
            The preview is the first thing to go on a short viewport. On a
            1280x720 laptop the headline, the copy and the preview together
            overflow the sticky column, and a clipped decoration reads as a
            bug; the panel is complete without it.
          */}
          <div className="auth-preview-slot mt-12 pr-6">
            <AuthProductPreview />
          </div>
        </div>

        <p className="text-[13px] font-medium text-auth-muted">
          Built for modern healthcare teams.
        </p>
      </div>
    </aside>
  );
}
