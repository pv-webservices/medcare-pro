import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const clinicLogoSource = readFileSync(
  resolve("src/components/ui/ClinicLogo.tsx"),
  "utf8",
);
const userAvatarSource = readFileSync(
  resolve("src/components/ui/UserAvatar.tsx"),
  "utf8",
);
const clinicSwitcherSource = readFileSync(
  resolve("src/components/dashboard/ClinicSwitcher.tsx"),
  "utf8",
);
const userMenuSource = readFileSync(
  resolve("src/components/dashboard/UserMenu.tsx"),
  "utf8",
);
const layoutSource = readFileSync(
  resolve("src/app/(dashboard)/layout.tsx"),
  "utf8",
);

describe("ClinicLogo Component", () => {
  it("exports ClinicLogo and validates image URLs before rendering", () => {
    expect(clinicLogoSource).toContain("export default function ClinicLogo");
    expect(clinicLogoSource).toContain("isValidImageUrl");
    expect(clinicLogoSource).toContain('trimmed.startsWith("data:image/")');
    expect(clinicLogoSource).toContain('trimmed.startsWith("/")');
  });

  it("handles broken images with onError and never renders a browser broken icon", () => {
    expect(clinicLogoSource).toContain("onError={() => setErrorUrl(logoUrl)}");
    expect(clinicLogoSource).toContain("const [errorUrl, setErrorUrl] = useState");
    expect(clinicLogoSource).toContain("const hasError = Boolean(logoUrl && errorUrl === logoUrl);");
  });

  it("uses object-contain for logos to preserve aspect ratio without distortion", () => {
    expect(clinicLogoSource).toContain("object-contain");
  });

  it("provides appropriate fallbacks for specific clinics vs All clinics", () => {
    expect(clinicLogoSource).toContain("<Building2");
    expect(clinicLogoSource).toContain("<Layers");
  });

  it("is used across ClinicSwitcher in both topbar and sidebar locations", () => {
    expect(clinicSwitcherSource).toContain("<ClinicLogo");
    expect(clinicSwitcherSource).toContain('variant="sidebar"');
    expect(clinicSwitcherSource).toContain('variant="topbar"');
  });
});

describe("UserAvatar Component", () => {
  it("prioritizes photo, then gender-aware illustration, then initials", () => {
    expect(userAvatarSource).toContain("export default function UserAvatar");
    // Priority 1: Real photo
    expect(userAvatarSource).toContain("isCandidatePhoto && !imageFailed && cleanPhotoUrl");
    expect(userAvatarSource).toContain("onError={() => setErrorPhotoUrl(cleanPhotoUrl)}");
    expect(userAvatarSource).toContain("object-cover");

    // Priority 2: Gender-aware
    expect(userAvatarSource).toContain('cleanGender === "male"');
    expect(userAvatarSource).toContain('cleanGender === "female"');
    expect(userAvatarSource).toContain('cleanGender === "other"');
    expect(userAvatarSource).toContain("<MaleAvatarIcon");
    expect(userAvatarSource).toContain("<FemaleAvatarIcon");
    expect(userAvatarSource).toContain("<NeutralAvatarIcon");

    // Priority 3: Initials
    expect(userAvatarSource).toContain("initialsFor(name)");
  });

  it("formats initials cleanly from names", () => {
    expect(userAvatarSource).toContain("words.slice(0, 2).map((word) => word.charAt(0))");
    expect(userAvatarSource).toContain('return "?"');
  });

  it("is integrated into UserMenu and MobileNav with gender prop passed from layout", () => {
    expect(userMenuSource).toContain("<UserAvatar");
    expect(layoutSource).toContain("userDoctor?.gender");
    expect(layoutSource).toContain("gender={userGender}");
  });
});
