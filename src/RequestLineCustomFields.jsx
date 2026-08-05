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
        inputId="request-line-profession"
        label="Profession / المهنة"
        value={value.profession}
        onChange={(nextValue) => onFieldChange("profession", nextValue)}
        placeholder="Search profession / ابحث عن المهنة"
        searchable
        options={professionOptions}
        loading={loading}
        error={error}
        helperText={`${professionOptions.length.toLocaleString()} approved professions — type to search`}
        emptyMessage="No approved professions found"
      />
      <Select
        inputId="request-line-nationality"
        label="Nationality / الجنسية"
        value={value.nationality}
        onChange={(nextValue) => onFieldChange("nationality", nextValue)}
        placeholder="Search nationality / ابحث عن الجنسية"
        searchable
        options={nationalityOptions}
        loading={loading}
        error={error}
        helperText={`${nationalityOptions.length.toLocaleString()} approved nationalities — type to search`}
        emptyMessage="No approved nationalities found"
      />
    </>
  );
}
