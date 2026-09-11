import { useRef, useState } from "react";

export default function Select({
  value,
  onChange,
  placeholder,
  options = [],
  searchable = false,
  disabled = false,
  allowCustomValue = false,
  loading = false,
  error = "",
  emptyMessage = "No options available",
  label = "",
  inputId,
  helperText = "",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState("");
  const optionPickedRef = useRef(false);
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

  const exactMatch = filtered.find((option) => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery && [getOptionLabel(option), getOptionValue(option)].some((candidate) => candidate.toLowerCase() === normalizedQuery);
  });
  const commitOption = (option) => {
    optionPickedRef.current = true;
    onChange(getOptionValue(option));
    setSelectionMessage("");
    setOpen(false);
    setQuery("");
  };

  return (
    <div>
      {label && (
        <label htmlFor={inputId} style={{ display: "block", marginBottom: 7, color: "#0f2b5b", fontSize: 14, fontWeight: 800 }}>
          {label}
        </label>
      )}
      <div style={{ position: "relative" }}>
        <input
          id={inputId}
          role="combobox"
          aria-label={label || placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          value={open ? query : selectedLabel}
          placeholder={placeholder}
          disabled={disabled || loading || Boolean(error)}
          aria-invalid={Boolean(error)}
          aria-busy={loading}
          style={{ paddingRight: 44 }}
          onFocus={() => {
          if (disabled || loading || error) return;
          optionPickedRef.current = false;
          setSelectionMessage("");
          setOpen(true);
          setQuery(allowCustomValue ? String(value || "") : "");
        }}
          onBlur={() => {
          const uncommittedQuery = query.trim();
          setTimeout(() => {
            setOpen(false);
            setQuery("");
            if (!allowCustomValue && uncommittedQuery && !optionPickedRef.current) {
              setSelectionMessage("Select an approved option from the list / اختر خيارًا معتمدًا من القائمة.");
            }
          }, 150);
        }}
          onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setQuery("");
            event.target.blur();
            return;
          }
          if (event.key === "Enter" && !allowCustomValue && (exactMatch || filtered.length === 1)) {
            event.preventDefault();
            commitOption(exactMatch || filtered[0]);
            return;
          }
          if (event.key === "Enter" && !allowCustomValue && query.trim()) {
            event.preventDefault();
            setSelectionMessage(
              filtered.length > 1
                ? `Choose one of ${filtered.length} matching options / اختر أحد الخيارات المطابقة.`
                : "No approved matching option / لا يوجد خيار معتمد مطابق."
            );
          }
        }}
          onChange={(event) => {
          if (disabled || loading || error) return;
          const nextValue = event.target.value;
          optionPickedRef.current = false;
          setSelectionMessage("");
          setQuery(nextValue);
          setOpen(true);
          if (allowCustomValue) onChange(nextValue);
          }}
        />
        <span aria-hidden="true" style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: "#0f2b5b", fontSize: 20, fontWeight: 900, pointerEvents: "none" }}>
          {open ? "⌃" : "⌄"}
        </span>

        {open && !disabled && !loading && !error && (
          <div role="listbox" style={{ position: "absolute", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 10, boxShadow: "0 14px 30px rgba(15, 43, 91, 0.16)", maxHeight: "250px", overflowY: "auto", width: "100%", zIndex: 9999 }}>
            {filtered.length > 80 && (
              <div role="status" style={{ padding: "8px 10px", color: "#475569", background: "#f8fafc", fontSize: 12, fontWeight: 700 }}>
                Showing 80 of {filtered.length}. Type to narrow the results.
              </div>
            )}
            {filtered.slice(0, 80).map((option) => (
              <div
                key={getOptionValue(option)}
                role="option"
                aria-selected={getOptionValue(option) === String(value || "")}
                data-select-option={getOptionValue(option)}
                style={{ padding: "9px 10px", cursor: "pointer" }}
                onMouseDown={() => {
                  commitOption(option);
                }}
              >
                {getOptionLabel(option)}
              </div>
            ))}
            {filtered.length === 0 && (
              <div role="status" style={{ padding: "8px", color: "#64748b" }}>{emptyMessage}</div>
            )}
          </div>
        )}
      </div>

      {(loading || error) && (
        <small role={error ? "alert" : "status"} style={{ display: "block", marginTop: 6, color: error ? "#b91c1c" : "#475569", fontWeight: 700 }}>
          {loading ? "Loading options..." : error}
        </small>
      )}

      {selectionMessage && !loading && !error && (
        <small role="alert" style={{ display: "block", marginTop: 6, color: "#b45309", fontWeight: 700 }}>
          {selectionMessage}
        </small>
      )}

      {helperText && !loading && !error && !selectionMessage && (
        <small style={{ display: "block", marginTop: 6, color: "#64748b", fontWeight: 600 }}>
          {helperText}
        </small>
      )}
    </div>
  );
}
