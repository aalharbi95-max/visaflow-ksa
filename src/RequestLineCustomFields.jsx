import Select from "./Select";

export default function RequestLineCustomFields({
  value,
  onFieldChange,
  professionOptions,
  nationalityOptions,
}) {
  return (
    <>
      <Select
        value={value.profession}
        onChange={(nextValue) => onFieldChange("profession", nextValue)}
        placeholder="Profession"
        searchable
        allowCustomValue
        options={professionOptions}
      />
      <Select
        value={value.nationality}
        onChange={(nextValue) => onFieldChange("nationality", nextValue)}
        placeholder="Nationality"
        searchable
        allowCustomValue
        options={nationalityOptions}
      />
    </>
  );
}
