import Select from "./Select";

export default function RequestLineCustomFields({
  value,
  onFieldChange,
  professionOptions,
  nationalityOptions,
  loading = false,
  error = "",
}) {
  return (
    <>
      <Select
        value={value.profession}
        onChange={(nextValue) => onFieldChange("profession", nextValue)}
        placeholder="Profession"
        searchable
        options={professionOptions}
        loading={loading}
        error={error}
        emptyMessage="No approved professions found"
      />
      <Select
        value={value.nationality}
        onChange={(nextValue) => onFieldChange("nationality", nextValue)}
        placeholder="Nationality / الجنسية"
        searchable
        options={nationalityOptions}
        loading={loading}
        error={error}
        emptyMessage="No approved nationalities found"
      />
    </>
  );
}
