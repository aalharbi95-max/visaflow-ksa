import { useState } from "react";

export default function Select({
  value,
  onChange,
  placeholder,
  options = [],
  searchable = false,
  disabled = false,
  allowCustomValue = false,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const getOptionValue = (option) => typeof option === "object" ? String(option.value ?? "") : String(option ?? "");
  const getOptionLabel = (option) => typeof option === "object" ? String(option.label ?? option.value ?? "") : String(option ?? "");
  const selectedOption = options.find((option) => getOptionValue(option) === String(value || ""));
  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : value || "";

  if (!searchable) {
    return (
      <select value={value || ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={getOptionValue(option)} value={getOptionValue(option)}>{getOptionLabel(option)}</option>
        ))}
      </select>
    );
  }

  const filtered = options.filter((option) =>
    getOptionLabel(option).toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery(allowCustomValue ? String(value || "") : "");
        }}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            setQuery("");
          }, 150);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setQuery("");
            event.target.blur();
          }
        }}
        onChange={(event) => {
          if (disabled) return;
          const nextValue = event.target.value;
          setQuery(nextValue);
          setOpen(true);
          if (allowCustomValue) onChange(nextValue);
        }}
      />

      {open && !disabled && (
        <div style={{ position: "absolute", background: "#fff", border: "1px solid #ddd", maxHeight: "250px", overflowY: "auto", width: "100%", zIndex: 9999 }}>
          {filtered.slice(0, 80).map((option) => (
            <div
              key={getOptionValue(option)}
              data-select-option={getOptionValue(option)}
              style={{ padding: "8px", cursor: "pointer" }}
              onMouseDown={() => {
                onChange(getOptionValue(option));
                setOpen(false);
                setQuery("");
              }}
            >
              {getOptionLabel(option)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
