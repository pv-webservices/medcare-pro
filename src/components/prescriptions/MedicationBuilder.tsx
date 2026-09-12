"use client";

import Input, { Textarea } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import {
  MEDICATION_OPTIONS,
  medicationSchema,
  type MedicationInput,
} from "@/lib/prescriptionValidation";

const FIELDS = [
  ["medicineGenericName", "Generic medicine name", 255],
  ["brandName", "Brand (optional)", 255],
  ["dosageForm", "Dosage form", 100],
  ["strength", "Strength", 100],
  ["dose", "Dose", 100],
  ["route", "Route", 100],
  ["frequency", "Frequency", 100],
  ["timing", "Timing", 100],
  ["durationUnit", "Duration unit", 50],
] as const;

export default function MedicationBuilder({
  items,
  onChange,
  errors = {},
}: {
  items: MedicationInput[];
  onChange: (items: MedicationInput[]) => void;
  errors?: Record<string, string>;
}) {
  function update(index: number, patch: Partial<MedicationInput>) {
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  function move(index: number, delta: number) {
    const copy = [...items];
    [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
    onChange(copy);
  }
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <fieldset
          key={index}
          className="rounded-2xl border border-line bg-canvas p-4"
        >
          <legend className="px-2 font-semibold text-ink">
            Medication {index + 1}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([key, label, maxLength]) => {
              const options =
                key in MEDICATION_OPTIONS
                  ? MEDICATION_OPTIONS[key as keyof typeof MEDICATION_OPTIONS]
                  : null;
              const id = `medicine-${index}-${key}`;
              return (
                <div
                  key={key}
                  className={
                    key === "medicineGenericName" ? "sm:col-span-2" : ""
                  }
                >
                  <Input
                    id={id}
                    label={label}
                    value={item[key]}
                    maxLength={maxLength}
                    list={options ? `${id}-options` : undefined}
                    error={errors[`medications.${index}.${key}`]}
                    onChange={(e) => update(index, { [key]: e.target.value })}
                  />
                  {options && (
                    <datalist id={`${id}-options`}>
                      {options.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  )}
                </div>
              );
            })}
            <Input
              id={`medicine-${index}-duration`}
              label="Duration"
              type="number"
              min={1}
              max={3650}
              value={item.durationValue ?? ""}
              error={errors[`medications.${index}.durationValue`]}
              onChange={(e) =>
                update(index, {
                  durationValue:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <Input
              id={`medicine-${index}-quantity`}
              label="Quantity (optional)"
              type="number"
              min={1}
              max={100000}
              value={item.quantity ?? ""}
              error={errors[`medications.${index}.quantity`]}
              onChange={(e) =>
                update(index, {
                  quantity:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <div className="sm:col-span-2">
              <Textarea
                id={`medicine-${index}-instructions`}
                label="Instructions"
                rows={2}
                maxLength={4000}
                value={item.instructions}
                error={errors[`medications.${index}.instructions`]}
                onChange={(e) =>
                  update(index, { instructions: e.target.value })
                }
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={index === 0}
              onClick={() => move(index, -1)}
              aria-label={`Move medication ${index + 1} up`}
            >
              Move up
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
              aria-label={`Move medication ${index + 1} down`}
            >
              Move down
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={items.length >= 50}
              onClick={() =>
                onChange([
                  ...items.slice(0, index + 1),
                  { ...item },
                  ...items.slice(index + 1),
                ])
              }
            >
              Duplicate
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              aria-label={`Remove medication ${index + 1}`}
            >
              Remove
            </Button>
          </div>
        </fieldset>
      ))}
      {errors.medications && (
        <p role="alert" className="text-alert-ink">
          {errors.medications}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={items.length >= 50}
        onClick={() => onChange([...items, medicationSchema.parse({})])}
      >
        + Add medicine
      </Button>
    </div>
  );
}
