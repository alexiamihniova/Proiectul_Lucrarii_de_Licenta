// Registrul extractorilor. Pentru un format nou: creează extractors/<format>.js care exportă
// { extensions, extract(buffer) -> { pages: string[], detectRepeatedLines: boolean } }
// și adaugă-l în lista de mai jos. Logica de upload nu trebuie modificată.
const EXTRACTORS = [require("./pdf"), require("./docx"), require("./txt"), require("./pptx")];

const byExtension = new Map();
for (const extractor of EXTRACTORS) {
  for (const ext of extractor.extensions) byExtension.set(ext, extractor);
}

function getExtractor(ext) {
  return byExtension.get(ext.toLowerCase());
}

const SUPPORTED_EXTENSIONS = [...byExtension.keys()];

module.exports = { getExtractor, SUPPORTED_EXTENSIONS };
