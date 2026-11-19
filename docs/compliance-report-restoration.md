# Compliance report restoration — 2026-11-19

AI Report Studio again includes `tawteen_localization` and `saudi_workforce`. The occupation calculation, salary evidence, localization and PowerPoint modules were recovered from the desktop development copy and are now versioned with the application. The restored entry points are deliberately independent of that copy's unrelated application refactor.

## Review and corrections

- Accounting uses entity scope, matching section 3.1 of the April 2026 HRSD procedural guide. The reference was updated from the older January attachment.
- Unknown qualifying wages, qualifications, accreditation or entity scope remain unknown; they do not become eligible workers or a zero shortfall.
- Nitaqat requires complete company scope, known nationality and GOSI wages, no duplicate employee IDs, and the year covered by the stored 2026 curves. Project excerpts cannot establish a company band. Hiring uses the changing denominator and changing activity threshold.
- Tenant-bound data is fetched in ordered pages. Any failed page, missing rules, failed profile query or foreign company row prevents export rather than producing a partial report. Workspace/role changes unmount prior report state. RLS remains authoritative; no service credentials are used in the browser.
- Exports preserve the same calculation model. Tawteen supports Arabic, English and bilingual PowerPoint, Excel, Word-compatible HTML, HTML and browser print to PDF. Nitaqat is bilingual. PDF uses the browser's save-as-PDF dialog; Word exports HTML with a `.doc` extension, not native DOCX.
- Existing occupation decisions and 2026 Nitaqat activity curves are restored, not invented. Unmodeled decision conditions remain pending review. This is an internal planning model, not a live Qiwa determination or a certification of legal compliance.

## Sources checked

- Accounting guide: https://www.hrsd.gov.sa/sites/default/files/2026-04/aldlyl-alajrayy-lqrar-twtyn-almhn-almhasbyt.pdf
- Nitaqat calculator, including entity scope, workforce weights and the six-worker minimum: https://es.hrsd.gov.sa/services/inquiry/NitaqatCalculatorMotawar2026.aspx
- HRSD engineering commencement announcement (30 June 2026) and project-management guide (14 February 2027) were checked against the recovered effective dates. Existing source URLs remain embedded in each decision report.

## Validation

`npm run test:compliance`: 34 tests, including wage boundaries, accounting phase applicability, replacement versus additive hiring, unknown eligibility, duplicates, tenant isolation, pagination, project/year guards, actual XLSX/PPTX generation in three languages, and a headless Chrome component test of both report previews and Excel downloads.

`npm test`: 312 passing application regression tests. `npm run build`: successful; existing large application/housing chunk warnings remain. CI now runs the compliance suite.

Production requires the existing compliance schema (`compliance_rules`, `compliance_effective_rule_professions`, `compliance_rule_conditions`, `employee_compliance_attributes`, `company_compliance_profiles`). This restoration does not change employee records, profile confirmations, RLS or regulatory seed data. A missing schema or inaccessible rule base is shown as an explicit error.
