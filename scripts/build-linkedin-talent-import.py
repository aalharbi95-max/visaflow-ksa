from __future__ import annotations

import csv
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "outputs" / "linkedin-applicants-20260814" / "FlowKSA_Applicants_Latest"
WORKBOOK = PACKAGE / "FlowKSA_All_Applicants_Latest.xlsx"
STATUS_CSV = PACKAGE / "cv_download_status.csv"
CV_DIR = PACKAGE / "cvs"
OUT_DIR = PACKAGE / "import"


CATEGORIES = [
    ("Facilities Management & O&M", [
        "facilities management", "facility management", "fm operations", "cafm", "hard services",
        "soft services", "operation and maintenance", "operations and maintenance", "o&m", "hvac", "mep",
    ]),
    ("Business Development & Sales", [
        "business development", "sales manager", "sales executive", "account manager", "key account",
        "commercial manager", "partnership", "revenue growth", "sales target", "client acquisition",
    ]),
    ("Project Management & Engineering", [
        "project manager", "project engineer", "project management", "construction manager", "civil engineer",
        "mechanical engineer", "electrical engineer", "infrastructure", "pmp", "site engineer",
    ]),
    ("Procurement, Tenders & Contracts", [
        "procurement", "sourcing", "tender", "contracts manager", "contract management", "vendor management",
        "supply chain", "rfp", "rfq", "bidding",
    ]),
    ("Finance, Banking & Investment", [
        "financial analyst", "finance manager", "accountant", "accounting", "investment", "banking",
        "portfolio", "treasury", "audit", "cfa",
    ]),
    ("Real Estate & Leasing", [
        "real estate", "leasing", "property management", "property manager", "asset management", "brokerage",
    ]),
    ("Human Resources & Administration", [
        "human resources", "hr manager", "recruitment", "talent acquisition", "personnel", "administration manager",
    ]),
    ("Marketing & Communications", [
        "marketing", "digital marketing", "brand manager", "communications", "social media", "content marketing",
    ]),
    ("Legal, Governance & Compliance", [
        "legal counsel", "lawyer", "legal advisor", "compliance", "governance", "regulatory", "law firm",
    ]),
    ("Technology, Data & Digital", [
        "software engineer", "developer", "information technology", "data analyst", "cybersecurity", "digital transformation",
        "cloud", "erp", "sap",
    ]),
    ("Operations & Customer Experience", [
        "operations manager", "operations supervisor", "customer experience", "customer service", "service delivery",
        "branch manager", "logistics",
    ]),
    ("Education & Consulting", [
        "educational consultant", "education consultant", "higher education", "academic advisor", "training consultant",
    ]),
]

SKILL_KEYWORDS = [
    ("Facilities Management", ["facilities management", "facility management", "fm operations"]),
    ("Operations & Maintenance", ["operation and maintenance", "operations and maintenance", "o&m", "maintenance"]),
    ("MEP", ["mep", "mechanical electrical plumbing"]),
    ("HVAC", ["hvac"]),
    ("CAFM", ["cafm"]),
    ("Business Development", ["business development", "client acquisition"]),
    ("B2B Sales", ["b2b", "corporate sales", "sales target"]),
    ("Key Account Management", ["key account", "account management"]),
    ("Tender Management", ["tender", "bidding", "rfp", "rfq"]),
    ("Contract Management", ["contract management", "contracts manager"]),
    ("Procurement", ["procurement", "sourcing"]),
    ("Project Management", ["project management", "project manager", "pmp"]),
    ("Stakeholder Management", ["stakeholder"]),
    ("Negotiation", ["negotiation", "negotiating"]),
    ("Government Sector", ["government sector", "government entities", "public sector"]),
    ("Private Sector", ["private sector"]),
    ("Financial Analysis", ["financial analysis", "financial analyst"]),
    ("Investment", ["investment", "portfolio"]),
    ("Accounting", ["accounting", "accountant"]),
    ("Real Estate", ["real estate", "property management"]),
    ("Leasing", ["leasing"]),
    ("Supply Chain", ["supply chain", "logistics"]),
    ("Human Resources", ["human resources", "hr manager"]),
    ("Recruitment", ["recruitment", "talent acquisition"]),
    ("Digital Marketing", ["digital marketing", "social media"]),
    ("Compliance", ["compliance", "regulatory"]),
    ("Data Analysis", ["data analyst", "data analysis"]),
    ("Digital Transformation", ["digital transformation"]),
    ("Customer Experience", ["customer experience", "customer service"]),
    ("Consulting", ["consultant", "consulting"]),
]


def clean(value) -> str | None:
    if value is None:
        return None
    result = re.sub(r"\s+", " ", str(value)).strip()
    return result or None


def extract_pdf_text(path: Path) -> str:
    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text(x_tolerance=2, y_tolerance=3) or "")
    return "\n".join(pages)


def keyword_score(text: str, terms: list[str]) -> int:
    return sum(min(text.count(term), 4) for term in terms)


def classify(text: str, title: str | None) -> tuple[str, list[str]]:
    haystack = f"{title or ''}\n{text}".lower()
    scored = [(name, keyword_score(haystack, terms)) for name, terms in CATEGORIES]
    scored.sort(key=lambda item: item[1], reverse=True)
    primary, primary_score = scored[0]
    secondary, secondary_score = scored[1]

    if primary_score == 0:
        primary = clean(title) or "General Professional"
    elif primary == "Business Development & Sales" and secondary == "Facilities Management & O&M" and secondary_score >= 2:
        primary = "Facilities Management Business Development"
    elif primary == "Facilities Management & O&M" and secondary == "Business Development & Sales" and secondary_score >= 2:
        primary = "Facilities Management Business Development"
    elif primary == "Business Development & Sales" and secondary == "Real Estate & Leasing" and secondary_score >= 2:
        primary = "Real Estate Business Development & Leasing"
    elif primary == "Project Management & Engineering" and secondary == "Facilities Management & O&M" and secondary_score >= 3:
        primary = "FM, MEP & O&M Project Management"
    elif primary == "Business Development & Sales" and secondary == "Procurement, Tenders & Contracts" and secondary_score >= 3:
        primary = "Business Development, Tenders & Contracts"

    skills = [label for label, terms in SKILL_KEYWORDS if keyword_score(haystack, terms) > 0]
    return primary, skills[:8]


def years_experience(text: str) -> int | None:
    first_page = text[:7000].lower()
    values = []
    for pattern in (
        r"(?:over|more than|morethan|above)\s+(\d{1,2})\+?\s+years",
        r"(\d{1,2})\+\s+years",
        r"(?:experience|experienced professional)\s+(?:of|with)?\s*(\d{1,2})\s+years",
    ):
        values.extend(int(match) for match in re.findall(pattern, first_page))
    values = [value for value in values if 1 <= value <= 40]
    if values:
        return max(values)

    # Do not infer tenure from the oldest year in the document: dates of birth,
    # education and certifications would overstate experience. An absent explicit
    # statement remains null rather than publishing an unreliable number.
    return None


def summary_for(specialty: str, years: int | None, skills: list[str], location: str | None) -> str:
    lead = f"Professional specializing in {specialty}"
    if years:
        lead += f" with approximately {years} years of experience"
    capability = ", ".join(skills[:5])
    if capability:
        lead += f". Core capabilities include {capability}"
    if location:
        lead += f"; based in {location}"
    return lead.rstrip(".") + "."


def workbook_rows() -> list[dict]:
    namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(WORKBOOK) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("x:si", namespace):
                shared.append("".join(node.text or "" for node in item.findall(".//x:t", namespace)))
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_ns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
        rels = {rel.attrib["Id"]: rel.attrib["Target"] for rel in relationships.findall("r:Relationship", rel_ns)}
        sheet_node = next(node for node in workbook.findall("x:sheets/x:sheet", namespace) if node.attrib["name"] == "Job Applicants")
        rel_id = sheet_node.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = rels[rel_id].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheet = ElementTree.fromstring(archive.read(target))
        table = []
        for row in sheet.findall("x:sheetData/x:row", namespace):
            values = {}
            for cell in row.findall("x:c", namespace):
                ref = cell.attrib["r"]
                column_letters = re.match(r"[A-Z]+", ref).group(0)
                column = 0
                for char in column_letters:
                    column = column * 26 + ord(char) - 64
                value_node = cell.find("x:v", namespace)
                inline_node = cell.find("x:is", namespace)
                value = None
                if inline_node is not None:
                    value = "".join(node.text or "" for node in inline_node.findall(".//x:t", namespace))
                elif value_node is not None:
                    raw = value_node.text or ""
                    if cell.attrib.get("t") == "s":
                        value = shared[int(raw)]
                    else:
                        value = raw
                values[column] = value
            width = max(values) if values else 0
            table.append([values.get(index) for index in range(1, width + 1)])
    headers = [clean(value) or "" for value in table[0]]
    return [dict(zip(headers, row)) for row in table[1:] if any(value is not None for value in row)]


def cv_map() -> dict[str, Path]:
    mapping = {}
    with STATUS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("download_status") != "Downloaded" or not row.get("cv_filename"):
                continue
            mapping[row["email"].strip().lower()] = CV_DIR / row["cv_filename"]
    return mapping


def iso_date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = clean(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return None


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mapping = cv_map()
    output = []
    review = []
    missing = []

    for row_number, row in enumerate(workbook_rows(), start=2):
        email = (clean(row.get("Email Address")) or "").lower()
        if not email:
            continue
        path = mapping.get(email)
        if not path or not path.exists():
            missing.append(email)
            continue
        text = extract_pdf_text(path)
        current_title = clean(row.get("Current Title"))
        specialty, skills = classify(text, current_title)
        years = years_experience(text)
        location = clean(row.get("General Location"))
        first_name = clean(row.get("First Name"))
        last_name = clean(row.get("Last Name"))
        full_name = clean(" ".join(part for part in (first_name, last_name) if part)) or email
        summary = summary_for(specialty, years, skills, location)
        record = {
            "source": "LinkedIn",
            "source_row_number": row_number,
            "email": email,
            "full_name": full_name,
            "first_name": first_name,
            "last_name": last_name,
            "phone": clean(row.get("Phone Number")),
            "general_location": location,
            "headline": clean(row.get("Headline")),
            "current_title": current_title,
            "current_company": clean(row.get("Current Company")),
            "education_degree": clean(row.get("Education Degree")),
            "education_institution": clean(row.get("Education Institution")),
            "linkedin_url": clean(row.get("Profile URL")),
            "applied_at": iso_date(row.get("Date Applied")),
            "source_stage": clean(row.get("Current Stage")),
            "source_job_id": clean(row.get("Job ID")),
            "source_job_title": clean(row.get("Job Title")),
            "source_job_url": clean(row.get("Job URL")),
            "source_project_id": clean(row.get("Hiring Project ID")),
            "source_project_title": clean(row.get("Hiring Project Title")),
            "screening_responses": clean(row.get("Screening Questions")),
            "cv_filename": path.name,
            "cv_specialty": specialty,
            "cv_professional_summary": summary,
            "cv_years_experience": years,
            "cv_skills": skills,
        }
        output.append(record)
        review.append({
            "name": full_name,
            "email": email,
            "specialty": specialty,
            "years": years,
            "skills": skills,
            "summary": summary,
            "cv_filename": path.name,
        })

    if missing:
        raise SystemExit(f"Missing CV files for {len(missing)} candidates: {', '.join(missing)}")
    if len(output) != 56:
        raise SystemExit(f"Expected 56 candidates, generated {len(output)}")

    payload = json.dumps(output, ensure_ascii=False, indent=2)
    (OUT_DIR / "FlowKSA_Talent_Import_56.json").write_text(payload, encoding="utf-8")
    source_file = "FlowKSA_All_Applicants_Latest.xlsx"
    consent_basis = (
        "LinkedIn application consent confirmed by Platform Owner on 2026-08-15; "
        "anonymous marketplace profile is visible while contact and employer identity require candidate approval."
    )
    upload_sql = f"""begin;
select set_config(
  'request.jwt.claim.sub',
  (select platform_user.auth_user_id::text from public.users platform_user
   where platform_user.company_id is null and platform_user.role = 'Platform Owner'
     and platform_user.is_active is true and lower(coalesce(platform_user.status, '')) = 'active'
   order by platform_user.created_at limit 1),
  true
);
select public.import_talent_cv_profiles(
  $talent_rows${payload}$talent_rows$::jsonb,
  '{source_file.replace("'", "''")}',
  '{consent_basis.replace("'", "''")}'
) as import_result;
commit;
"""
    (OUT_DIR / "FlowKSA_Talent_Import_56.sql").write_text(upload_sql, encoding="utf-8")
    with (OUT_DIR / "FlowKSA_Talent_Classification_Review.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=["name", "email", "specialty", "years", "skills", "summary", "cv_filename"])
        writer.writeheader()
        for item in review:
            item = dict(item)
            item["skills"] = " | ".join(item["skills"])
            writer.writerow(item)

    distribution = {}
    for item in output:
        distribution[item["cv_specialty"]] = distribution.get(item["cv_specialty"], 0) + 1
    print(json.dumps({"candidates": len(output), "missing_cvs": 0, "distribution": distribution}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
