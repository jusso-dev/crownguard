import { useId, useState } from "react";
import { parseHex } from "../theme/color";
import { inputClass } from "./ui";

/** Colour swatch picker plus a hex code box, kept in sync. Invalid hex is flagged and not applied. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value.toUpperCase());
  const [seen, setSeen] = useState(value);
  const [touched, setTouched] = useState(false);

  // Follow outside changes (swatch, logo colour extraction, opening a file) without an effect.
  if (value !== seen) {
    setSeen(value);
    if (parseHex(text) !== value) setText(value.toUpperCase());
  }
  const parsed = parseHex(text);
  const invalid = touched && parsed === null;

  return (
    <div>
      <label htmlFor={`${id}-hex`} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-field bg-surface p-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          id={`${id}-hex`}
          className={`${inputClass} font-mono uppercase tabular-nums ${invalid ? "border-danger!" : ""}`}
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          placeholder="#0B5D4B"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const hex = parseHex(e.target.value);
            if (hex) onChange(hex);
          }}
          onBlur={() => {
            setTouched(true);
            if (parsed) setText(parsed.toUpperCase());
          }}
        />
      </div>
      {invalid && (
        <p id={`${id}-err`} className="mt-1 text-xs text-danger">
          Use a hex code like #0B5D4B or #0B5.
        </p>
      )}
    </div>
  );
}
