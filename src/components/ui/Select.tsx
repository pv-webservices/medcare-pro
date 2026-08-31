"use client";

import { Check, ChevronDown } from "lucide-react";
import React, {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui/cx";
import { controlClasses, FieldShell } from "@/components/ui/Input";
import { useFloatingPopover } from "@/components/ui/useFloatingPopover";

export interface SelectOptionItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "size"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Hides the label visually but keeps it for screen readers. */
  isLabelHidden?: boolean;
  fieldClassName?: string;
  icon?: ReactNode;
  /** Optional small context header inside the dropdown panel (e.g. "Appointments · Admin") */
  contextHeader?: string;
  align?: "start" | "end" | "auto";
  children: ReactNode;
}

/** Recursively extracts options from children, handling fragments and optgroups if any */
function extractOptions(children: ReactNode): SelectOptionItem[] {
  const options: SelectOptionItem[] = [];

  function walk(nodes: ReactNode) {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;

      const props = child.props as {
        children?: ReactNode;
        value?: string | number;
        disabled?: boolean;
      };

      if (child.type === React.Fragment) {
        walk(props.children);
      } else if (
        typeof child.type === "string" &&
        child.type.toLowerCase() === "optgroup"
      ) {
        walk(props.children);
      } else if (
        typeof child.type === "string" &&
        child.type.toLowerCase() === "option"
      ) {
        const value =
          props.value !== undefined
            ? String(props.value)
            : String(props.children ?? "");

        let label = "";
        if (typeof props.children === "string" || typeof props.children === "number") {
          label = String(props.children);
        } else if (Array.isArray(props.children)) {
          label = props.children
            .map((c: unknown) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
            .join("");
        } else {
          label = value;
        }

        options.push({
          value,
          label: label || value,
          disabled: Boolean(props.disabled),
        });
      }
    });
  }

  walk(children);
  return options;
}

export default function Select({
  id,
  label,
  hint,
  error,
  isLabelHidden = false,
  fieldClassName,
  icon,
  className,
  children,
  value,
  defaultValue,
  disabled = false,
  required,
  onChange,
  onBlur,
  onFocus,
  name,
  contextHeader,
  align = "auto",
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const listboxId = `${id}-listbox-${generatedId.replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hiddenSelectRef = useRef<HTMLSelectElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  // Extracted option items
  const options = extractOptions(children);

  // Uncontrolled state fallback
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string>(() => {
    if (value !== undefined) return String(value);
    if (defaultValue !== undefined) return String(defaultValue);
    return options[0]?.value ?? "";
  });

  const activeValue = isControlled ? String(value) : internalValue;
  const selectedOption =
    options.find((opt) => opt.value === activeValue) ||
    options.find((opt) => !opt.disabled) ||
    options[0];

  const handleClose = useCallback(
    (opts?: { restoreFocus?: boolean }) => {
      setIsOpen(false);
      if (opts?.restoreFocus) {
        triggerRef.current?.focus();
      }
    },
    [],
  );

  const {
    position,
    dispatchOpenEvent,
    shouldIgnoreTriggerClick,
  } = useFloatingPopover({
    isOpen,
    onClose: handleClose,
    popoverId: listboxId,
    triggerRef,
    panelRef,
    align,
    defaultHeight: Math.min(options.length * 44 + 20, 280),
  });

  // Keep hidden select value in sync
  useEffect(() => {
    if (hiddenSelectRef.current && hiddenSelectRef.current.value !== activeValue) {
      hiddenSelectRef.current.value = activeValue;
    }
  }, [activeValue]);

  /** Scroll highlighted item into view when keyboard navigating */
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !panelRef.current) return;
    const items = panelRef.current.querySelectorAll<HTMLElement>('[role="option"]');
    const targetItem = items[highlightedIndex];
    if (targetItem) {
      targetItem.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, isOpen, panelRef]);

  function commitSelection(newVal: string) {
    if (newVal === activeValue) {
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (!isControlled) {
      setInternalValue(newVal);
    }

    const selectEl = hiddenSelectRef.current;
    if (selectEl) {
      // Programmatically set value on native hidden select
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )?.set;
      if (valueSetter) {
        valueSetter.call(selectEl, newVal);
      } else {
        selectEl.value = newVal;
      }

      // Dispatch native change event
      const event = new Event("change", { bubbles: true });
      selectEl.dispatchEvent(event);
    }

    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerClick(e: ReactMouseEvent<HTMLButtonElement>) {
    if (disabled) return;
    e.preventDefault();

    if (shouldIgnoreTriggerClick()) {
      return;
    }

    const willOpen = !isOpen;
    if (willOpen) {
      dispatchOpenEvent();
      setIsOpen(true);
      const idx = options.findIndex((opt) => opt.value === activeValue);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setIsOpen(false);
    }
  }

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        dispatchOpenEvent();
        setIsOpen(true);
        const idx = options.findIndex((opt) => opt.value === activeValue);
        setHighlightedIndex(idx >= 0 ? idx : 0);
      } else {
        moveHighlight(e.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isOpen) {
        dispatchOpenEvent();
        setIsOpen(true);
        const idx = options.findIndex((opt) => opt.value === activeValue);
        setHighlightedIndex(idx >= 0 ? idx : 0);
      } else if (highlightedIndex >= 0 && options[highlightedIndex]) {
        const option = options[highlightedIndex];
        if (!option.disabled) {
          commitSelection(option.value);
        }
      }
      return;
    }

    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      setIsOpen(false);
      return;
    }

    if (e.key === "Tab" && isOpen) {
      setIsOpen(false);
    }
  }

  function moveHighlight(step: number) {
    if (options.length === 0) return;
    let nextIndex = highlightedIndex;
    for (let i = 0; i < options.length; i++) {
      nextIndex = (nextIndex + step + options.length) % options.length;
      if (!options[nextIndex]?.disabled) {
        setHighlightedIndex(nextIndex);
        break;
      }
    }
  }

  function handlePanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      const firstEnabled = options.findIndex((opt) => !opt.disabled);
      if (firstEnabled >= 0) setHighlightedIndex(firstEnabled);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i]?.disabled) {
          setHighlightedIndex(i);
          break;
        }
      }
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (highlightedIndex >= 0 && options[highlightedIndex]) {
        const option = options[highlightedIndex];
        if (!option.disabled) {
          commitSelection(option.value);
        }
      }
      return;
    }

    if (e.key === "Tab") {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  const isInvalid = Boolean(error);

  const triggerControl = (
    <div className="relative">
      {/* Hidden native select for form serialization, accessibility fallback, and form submit */}
      <select
        ref={hiddenSelectRef}
        id={id}
        name={name}
        value={activeValue}
        required={required}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0"
        onChange={onChange}
        onBlur={onBlur}
        onFocus={onFocus}
        {...rest}
      >
        {children}
      </select>

      {/* Leading icon if provided */}
      {icon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted z-10"
        >
          {icon}
        </span>
      )}

      {/* Custom styled trigger button matching MEDCARE PRO design */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listboxId : undefined}
        aria-invalid={isInvalid ? true : undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        aria-label={isLabelHidden ? label : undefined}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={controlClasses(
          isInvalid,
          cx(
            "flex min-h-11 w-full items-center justify-between text-left",
            "cursor-pointer select-none",
            icon ? "pl-10" : "pl-3.5",
            "pr-3",
            isOpen && "border-accent ring-1 ring-accent",
            className,
          ),
        )}
      >
        <span className="truncate text-input font-normal text-ink">
          {selectedOption ? selectedOption.label : label}
        </span>

        <span className="pointer-events-none ml-2 flex shrink-0 items-center text-muted">
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2}
            className={cx(
              "h-4 w-4 transition-transform duration-200",
              isOpen && "rotate-180 text-accent",
            )}
          />
        </span>
      </button>

      {/* Portal-rendered elevated listbox panel */}
      {typeof document !== "undefined" &&
        isOpen &&
        createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={handlePanelKeyDown}
            style={{
              position: "fixed",
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              minWidth: position?.width ? `${position.width}px` : undefined,
              maxHeight: position?.maxHeight ? `${position.maxHeight}px` : "280px",
              zIndex: 9999,
              visibility: position ? "visible" : "hidden",
            }}
            className={cx(
              "overflow-hidden rounded-2xl border border-line bg-canvas p-1.5 shadow-float outline-none",
              "animate-in fade-in-0 zoom-in-95 duration-100",
            )}
          >
            {contextHeader && (
              <div className="border-b border-line px-3 py-1.5 text-meta font-semibold text-muted">
                {contextHeader}
              </div>
            )}

            <div className="max-h-[260px] overflow-y-auto space-y-0.5 overscroll-contain">
              {options.map((option, idx) => {
                const isSelected = option.value === activeValue;
                const isHighlighted = idx === highlightedIndex;

                return (
                  <div
                    key={`${option.value}-${idx}`}
                    role="option"
                    id={`${listboxId}-opt-${idx}`}
                    aria-selected={isSelected}
                    aria-disabled={option.disabled}
                    onPointerDown={(e) => {
                      // Prevent trigger blur before click fires
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!option.disabled) {
                        commitSelection(option.value);
                      }
                    }}
                    onMouseEnter={() => {
                      if (!option.disabled) {
                        setHighlightedIndex(idx);
                      }
                    }}
                    className={cx(
                      "flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-input transition-colors duration-100",
                      option.disabled
                        ? "cursor-not-allowed opacity-40 text-muted"
                        : "cursor-pointer",
                      isSelected
                        ? "bg-accent-soft text-accent font-semibold"
                        : isHighlighted
                          ? "bg-canvas-deep text-ink"
                          : "text-ink hover:bg-canvas-deep",
                    )}
                  >
                    <span className="truncate pr-2">{option.label}</span>
                    {isSelected && (
                      <Check
                        aria-hidden="true"
                        strokeWidth={2.5}
                        className="h-4 w-4 shrink-0 text-accent"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );

  if (isLabelHidden) {
    return (
      <div className={fieldClassName}>
        {triggerControl}
        {(error || hint) && (
          <p
            id={`${id}-message`}
            className={cx(
              "mt-2 text-meta font-medium",
              error ? "text-alert-ink" : "text-muted",
            )}
          >
            {error ?? hint}
          </p>
        )}
      </div>
    );
  }

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={fieldClassName}
    >
      {triggerControl}
    </FieldShell>
  );
}
