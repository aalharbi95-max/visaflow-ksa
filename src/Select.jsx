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
    <div style={{ position: "relative" }}>
      <input
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        disabled={disabled || loading || Boolean(error)}
        aria-invalid={Boolean(error)}
        aria-busy={loading}
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

      {open && !disabled && !loading && !error && (
        <div style={{ position: "absolute", background: "#fff", border: "1px solid #ddd", maxHeight: "250px", overflowY: "auto", width: "100%", zIndex: 9999 }}>
          {filtered.slice(0, 80).map((option) => (
            <div
              key={getOptionValue(option)}
              data-select-option={getOptionValue(option)}
              style={{ padding: "8px", cursor: "pointer" }}
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
  );
}
