const JSZip = require("jszip");
const { AppError } = require("../errors");

// Placeholder-e de subsol pe care nu le vrem în text: dată, footer, număr slide.
const SKIPPED_PLACEHOLDERS = /<p:ph\b[^>]*\btype="(dt|ftr|sldNum)"/;

function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function slideXmlToText(xml) {
  const shapes = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || [];
  const lines = [];
  for (const shape of shapes) {
    if (SKIPPED_PLACEHOLDERS.test(shape)) continue;
    const paragraphs = shape.match(/<a:p\b[\s\S]*?<\/a:p>/g) || [];
    for (const p of paragraphs) {
      const runs = p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [];
      lines.push(runs.map((r) => decodeXmlEntities(r.slice(5, -6))).join(""));
    }
  }
  return lines.join("\n");
}

// Ordinea reală a slide-urilor e în presentation.xml; numele fișierelor (slide3.xml) nu o garantează.
async function orderedSlidePaths(zip) {
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (presentation && rels) {
    const targets = {};
    for (const [, attrs] of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = attrs.match(/\bId="([^"]+)"/)?.[1];
      const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) targets[id] = "ppt/" + target.replace(/^\/?ppt\//, "").replace(/^\.\//, "");
    }
    const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
      .map(([, rid]) => targets[rid])
      .filter((p) => p && zip.file(p));
    if (ordered.length) return ordered;
  }

  const slideNumber = (p) => Number(p.match(/slide(\d+)\.xml$/)[1]);
  return Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
}

async function extract(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new AppError(422, "CORRUPT_FILE", "PPTX-ul este corupt sau nu poate fi citit (formatul vechi .ppt nu este suportat).");
  }

  const slidePaths = await orderedSlidePaths(zip);
  if (!slidePaths.length) {
    throw new AppError(422, "CORRUPT_FILE", "Fișierul nu conține slide-uri PowerPoint valide.");
  }

  const pages = [];
  for (const p of slidePaths) {
    pages.push(slideXmlToText(await zip.file(p).async("string")));
  }
  return { pages, detectRepeatedLines: false };
}

module.exports = { extensions: [".pptx"], extract };
