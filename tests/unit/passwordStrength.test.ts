import { describe, expect, test } from "vitest";
import { describePasswordStrength } from "@/components/auth/passwordStrength";
import { MIN_PASSWORD_LENGTH } from "@/lib/signupInput";

/**
 * The meter is advisory. These tests exist to hold that line: the only
 * assertion tied to a server-side rule is `isLongEnough`, and it must agree
 * with MIN_PASSWORD_LENGTH in src/lib/signupInput.ts — the value the API
 * actually enforces. If someone changes the rule, this fails here rather than
 * in production, where the form would reject passwords the API would accept.
 */
describe("describePasswordStrength", () => {
  test("reports too short until the real minimum is reached", () => {
    // Arrange
    const oneShort = "a".repeat(MIN_PASSWORD_LENGTH - 1);

    // Act
    const strength = describePasswordStrength(oneShort, MIN_PASSWORD_LENGTH);

    // Assert
    expect(strength.isLongEnough).toBe(false);
    expect(strength.score).toBe(0);
    expect(strength.label).toBe("Too short");
  });

  test("treats exactly the minimum as long enough", () => {
    const exact = "a".repeat(MIN_PASSWORD_LENGTH);

    const strength = describePasswordStrength(exact, MIN_PASSWORD_LENGTH);

    expect(strength.isLongEnough).toBe(true);
    expect(strength.score).toBeGreaterThan(0);
  });

  test("scores a long, varied password highest", () => {
    const varied = "Correct-Horse-Battery-7";

    const strength = describePasswordStrength(varied, MIN_PASSWORD_LENGTH);

    expect(strength.score).toBe(3);
    expect(strength.label).toBe("Strong");
  });

  test("scores a long but monotonous password above the floor, not at the top", () => {
    const plain = "a".repeat(MIN_PASSWORD_LENGTH + 8);

    const strength = describePasswordStrength(plain, MIN_PASSWORD_LENGTH);

    expect(strength.isLongEnough).toBe(true);
    expect(strength.score).toBe(1);
  });

  test("never reports a score above zero for an empty field", () => {
    const strength = describePasswordStrength("", MIN_PASSWORD_LENGTH);

    expect(strength.score).toBe(0);
    expect(strength.isLongEnough).toBe(false);
  });
});
