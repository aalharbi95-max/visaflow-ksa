import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import RequestLineCustomFields from "./RequestLineCustomFields";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
        professionOptions={["Engineer", "Accountant"]}
        nationalityOptions={["Saudi", "Indian"]}
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
          document.documentElement.dataset.savedPayload = btoa(JSON.stringify(payload));
        }}
      >
        Save Request
      </button>
    </>
  );
}

function recordResult(result) {
  document.documentElement.dataset.testResult = btoa(JSON.stringify(result));
}

async function runScenario() {
  try {
    const profession = document.querySelector('input[placeholder="Profession"]');
    const nationality = document.querySelector('input[placeholder="Nationality"]');
    const gender = document.querySelector('input[aria-label="Gender"]');
    const quantity = document.querySelector('input[aria-label="Quantity"]');

    profession.focus();
    setInputValue(profession, "Custom Profession");
    nationality.focus();
    await delay(180);
    const professionAfterBlur = profession.value;

    setInputValue(nationality, "Custom Nationality");
    profession.focus();
    await delay(180);
    const nationalityAfterBlur = nationality.value;
    const otherFieldsPreserved = gender.value === "Female" && quantity.value === "3";

    setInputValue(profession, "Eng");
    const engineerOption = document.querySelector('[data-select-option="Engineer"]');
    engineerOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await delay(0);
    const optionSelectionWorked = profession.value === "Engineer";

    document.querySelector("#add-line").click();
    await delay(0);
    document.querySelector("#save-request").click();
    await delay(0);

    const payload = JSON.parse(atob(document.documentElement.dataset.savedPayload));
    recordResult({
      professionAfterBlur,
      nationalityAfterBlur,
      otherFieldsPreserved,
      optionSelectionWorked,
      payload,
    });
  } catch (error) {
    document.documentElement.dataset.testError = btoa(String(error?.stack || error));
  }
}

flushSync(() => {
  createRoot(document.querySelector("#root")).render(<RequestLineHarness />);
});
setTimeout(runScenario, 0);
