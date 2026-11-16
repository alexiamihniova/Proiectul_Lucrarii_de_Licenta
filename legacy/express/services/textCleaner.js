// Curățarea textului brut extras: spații multiple, linii goale în exces,
// headere/footere repetate pe pagini și numere de pagină izolate.

const EDGE_LINES = 2; // câte linii de la începutul/sfârșitul paginii considerăm header/footer
const MIN_PAGES_FOR_DETECTION = 3;
const REPEAT_RATIO = 0.5; // o linie e header/footer dacă apare pe cel puțin jumătate din pagini

const PAGE_NUMBER = /^(pag(ina|e)?\.?\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(\s*(din|of|\/)\s*\d{1,4})?$/i;

function normalizeLines(text) {
  return text
    .replace(/\u0000/g, "") // PostgreSQL nu acceptă NUL în TEXT
    .replace(/­/g, "") // soft hyphen
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\s ]+/g, " ").trim());
}

// Cheie care ignoră cifrele, ca "Curs 3 – pagina 12" și "Curs 3 – pagina 13" să fie aceeași linie.
const lineKey = (line) => line.toLowerCase().replace(/\d+/g, "#");

function edgeIndexes(lines) {
  const nonEmpty = lines.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
  // Pe pagini scurte, marginile nu au voie să acopere conținutul propriu-zis.
  const k = Math.min(EDGE_LINES, Math.floor(nonEmpty.length / 3));
  if (k === 0) return new Set();
  return new Set([...nonEmpty.slice(0, k), ...nonEmpty.slice(-k)]);
}

function removeRepeatedEdges(pages) {
  const pageCount = new Map();
  for (const lines of pages) {
    const keys = new Set([...edgeIndexes(lines)].map((i) => lineKey(lines[i])));
    for (const k of keys) pageCount.set(k, (pageCount.get(k) || 0) + 1);
  }
  const threshold = Math.max(MIN_PAGES_FOR_DETECTION, Math.ceil(pages.length * REPEAT_RATIO));

  return pages.map((lines) => {
    const edges = edgeIndexes(lines);
    return lines.filter((line, i) => {
      if (!edges.has(i)) return true;
      if (PAGE_NUMBER.test(line)) return false;
      return (pageCount.get(lineKey(line)) || 0) < threshold;
    });
  });
}

function cleanText(pages, { detectRepeatedLines = false } = {}) {
  let pageLines = pages.map(normalizeLines);
  if (detectRepeatedLines && pageLines.length >= MIN_PAGES_FOR_DETECTION) {
    pageLines = removeRepeatedEdges(pageLines);
  }

  return pageLines
    .map((lines) => lines.join("\n").trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n"); // cel mult o linie goală între paragrafe
}

module.exports = { cleanText };
