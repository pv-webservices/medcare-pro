import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Select, { type SelectProps } from "@/components/ui/Select";

const options = [
  createElement("option", { key: "a", value: "" }, "All clinics"),
  createElement("option", { key: "b", value: "clinic-b" }, "Clinic B"),
  createElement("option", { key: "c", value: "clinic-c" }, "Clinic C"),
];
function render(props: Partial<SelectProps>) {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const html = renderToStaticMarkup(createElement(Select, { id: "clinic", label: "Clinic", ...props } as SelectProps, ...options));
  const messages = errors.mock.calls.map((call) => call.map(String).join(" "));
  return { html, messages };
}
/** The option the hidden native select submits, and the label the trigger shows. */
function selected(html: string) {
  return { native: /<option value="([^"]*)" selected="">/.exec(html)?.[1], shown: /<span class="truncate[^"]*">([^<]*)<\/span>/.exec(html)?.[1] };
}
afterEach(() => vi.restoreAllMocks());

describe("Select", () => {
  it("uncontrolled (defaultValue, no onChange) renders without a React warning", () => {
    const { html, messages } = render({ name: "clinicId", defaultValue: "clinic-c" });
    expect(messages).toEqual([]);
    expect(selected(html)).toEqual({ native: "clinic-c", shown: "Clinic C" });
  });

  it("uncontrolled with no defaultValue starts on the first option", () => {
    const { html, messages } = render({ name: "clinicId" });
    expect(messages).toEqual([]);
    expect(selected(html).shown).toBe("All clinics");
  });

  it("controlled (value + onChange) renders the given value without a warning", () => {
    const { html, messages } = render({ value: "clinic-b", onChange: () => {} });
    expect(messages).toEqual([]);
    expect(selected(html)).toEqual({ native: "clinic-b", shown: "Clinic B" });
  });
});
