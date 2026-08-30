export const MAIN_MENU_ROUTES = {
  "1": {
    action: "tomorrow-slots",
    instruction: "for tomorrow slots",
  },
  "2": {
    action: "appointment-booking",
    instruction: "for appointment booking",
  },
  "3": {
    action: "urgent-assistance",
    instruction: "for urgent assistance",
  },
  "4": {
    action: "clinic-information",
    instruction: "for clinic information",
  },
  "9": {
    action: "repeat-menu",
    instruction: "to repeat these options",
  },
} as const;

export type MainMenuDigit = keyof typeof MAIN_MENU_ROUTES;
export type MainMenuAction =
  | (typeof MAIN_MENU_ROUTES)[MainMenuDigit]["action"]
  | "invalid-input";

export function resolveMainMenuAction(
  digits: string | null | undefined,
): MainMenuAction {
  if (
    digits !== null &&
    digits !== undefined &&
    Object.hasOwn(MAIN_MENU_ROUTES, digits)
  ) {
    return MAIN_MENU_ROUTES[digits as MainMenuDigit].action;
  }

  return "invalid-input";
}
