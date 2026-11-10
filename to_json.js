const fs = require("node:fs");
const path = require("node:path");

const inputPath = path.join(__dirname, "data", "A부_조직도_26개과.csv");
const outputPath = path.join(__dirname, "org.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error("CSV의 따옴표가 닫히지 않았습니다.");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((values) => values.some((value) => value.trim() !== ""));
}

const csvText = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const rows = parseCsv(csvText);
const headers = rows[0].map((header) => header.trim());
const requiredHeaders = ["실국", "과", "대표키워드"];

for (const header of requiredHeaders) {
  if (!headers.includes(header)) {
    throw new Error(`필수 열이 없습니다: ${header}`);
  }
}

const indexes = Object.fromEntries(
  requiredHeaders.map((header) => [header, headers.indexOf(header)]),
);

const organization = rows.slice(1).map((values, rowIndex) => {
  if (values.length !== headers.length) {
    throw new Error(
      `${rowIndex + 2}행의 열 수가 머리글과 다릅니다: ${values.length}/${headers.length}`,
    );
  }

  return {
    실국: values[indexes.실국].trim(),
    과: values[indexes.과].trim(),
    대표키워드: values[indexes.대표키워드]
      .split("|")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  };
});

fs.writeFileSync(outputPath, `${JSON.stringify(organization, null, 2)}\n`, "utf8");

console.log(`원소 수: ${organization.length}`);
console.log("첫 원소:");
console.log(JSON.stringify(organization[0], null, 2));
