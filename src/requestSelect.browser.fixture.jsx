import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import RequestLineCustomFields from "./RequestLineCustomFields";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const toBase64 = (value) => btoa(String(value).replace(/[^\x00-\x7F]/g, (character) =>
  `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
));
const engineerProfession = `${[0x645, 0x647, 0x646, 0x62f, 0x633].map((code) => String.fromCharCode(code)).join("")} - Engineer`;
const accountantProfession = `${[0x645, 0x62d, 0x627, 0x633, 0x628].map((code) => String.fromCharCode(code)).join("")} - Accountant`;

function setInputValue(input, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  valueSetter.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
}

function RequestLineHarness() {
  const [line, setLine] = useState({
    profession: "",
    nationality: "",
    gender: "Female",
    quantity: "3",
  });
  const [draftLines, setDraftLines] = useState([]);

  return (
    <>
      <RequestLineCustomFields
        value={line}
        onFieldChange={(field, value) => setLine((previous) => ({ ...previous, [field]: value }))}
        professionOptions={[
          { value: engineerProfession, label: engineerProfession },
          { value: accountantProfession, label: accountantProfession },
        ]}
        nationalityOptions={[
          { value: "Saudi", label: "سعودي — Saudi" },
          { value: "Indian", label: "هندي — Indian" },
        ]}
      />
      <input aria-label="Gender" value={line.gender} onChange={(event) => setLine((previous) => ({ ...previous, gender: event.target.value }))} />
      <input aria-label="Quantity" value={line.quantity} onChange={(event) => setLine((previous) => ({ ...previous, quantity: event.target.value }))} />
      <button
        type="button"
        id="add-line"
        onClick={() => {
          setDraftLines((previous) => [...previous, { ...line }]);
          setLine({ profession: "", nationality: "", gender: "Female", quantity: "3" });
        }}
      >
        Add Line
      </button>
      <button
        type="button"
        id="save-request"
        onClick={() => {
          const payload = {
            request_type: "Project Recruitment",
            request_lines: draftLines.map((item) => ({ ...item, quantity: Number(item.quantity) })),
          };
          document.documentElement.dataset.savedPayload = toBase64(JSON.stringify(payload));
        }}
      >
        Save Request
      </button>
    </>
  );
}

function recordResult(result) {
  document.documentElement.dataset.testResult = toBase64(JSON.stringify(result));
}

async function runScenario() {
  try {
    const profession = document.querySelector("#request-line-profession");
    const nationality = document.querySelector("#request-line-nationality");
    const gender = document.querySelector('input[aria-label="Gender"]');
    const quantity = document.querySelector('input[aria-label="Quantity"]');

    profession.focus();
    setInputValue(profession, "Unapproved Profession");
    nationality.focus();
    await delay(180);
    const professionAfterBlur = profession.value;

    setInputValue(nationality, "هندي");
    const indianOption = document.querySelector('[data-select-option="Indian"]');
    indianOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    profession.focus();
    await delay(180);
    const nationalityAfterBlur = nationality.value;
    const otherFieldsPreserved = gender.value === "Female" && quantity.value === "3";

    setInputValue(profession, "Eng");
    const engineerOption = document.querySelector(`[data-select-option="${engineerProfession}"]`);
    engineerOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await delay(0);
    const optionSelectionWorked = profession.value.includes("Engineer") && nationality.value.includes("Indian");

    profession.focus();
    setInputValue(profession, "Engineer");
    profession.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await delay(0);
    const keyboardSelectionWorked = profession.value.includes("Engineer");

    document.querySelector("#add-line").click();
    await delay(0);
    document.querySelector("#save-request").click();
    await delay(0);

    const payload = JSON.parse(atob(document.documentElement.dataset.savedPayload));
    recordResult({
      professionAfterBlur,
      unapprovedProfessionRejected: professionAfterBlur === "",
      nationalityAfterBlur,
      otherFieldsPreserved,
      optionSelectionWorked,
      keyboardSelectionWorked,
      accessibleComboboxes: profession.getAttribute("role") === "combobox"
        && nationality.getAttribute("role") === "combobox"
        && Boolean(document.querySelector('label[for="request-line-profession"]'))
        && Boolean(document.querySelector('label[for="request-line-nationality"]')),
      payload,
    });
  } catch (error) {
    document.documentElement.dataset.testError = toBase64(String(error?.stack || error));
  }
}

flushSync(() => {
  createRoot(document.querySelector("#root")).render(<RequestLineHarness />);
});
setTimeout(runScenario, 0);
