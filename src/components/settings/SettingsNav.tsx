import TabNav, { type TabItem } from "@/components/ui/TabNav";

/**
 * Section navigation for the Settings screens.
 *
 * IT LISTS ONLY WHAT THE READER CAN OPEN. The sections arrive already filtered
 * by `visibleSettingsSections` in the page that renders this, using the same
 * predicate the landing page and the sidebar use. A tab here that led to a
 * refusal would be worse than no tab.
 *
 * It is a plain server component wrapping the shared TabNav, so every settings
 * screen gets the same row in the same place without four copies of the same
 * markup — and so the "Settings" entry in the sidebar keeps meaning one place
 * rather than four.
 */

interface SettingsNavProps {
  items: readonly TabItem[];
}

export default function SettingsNav({ items }: SettingsNavProps) {
  if (items.length < 2) {
    // One reachable section is not a choice, and a single tab is chrome.
    return null;
  }

  return <TabNav items={items} label="Settings sections" className="mb-6 md:mb-8" />;
}
