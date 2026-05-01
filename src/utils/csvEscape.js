export function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const escaped = text.replace(/"/g, '""');

  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }

  return escaped;
}

export function toCsvRow(values) {
  return values.map(csvEscape).join(",");
}
