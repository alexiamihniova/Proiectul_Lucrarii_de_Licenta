# legacy/

Pre-foundation prototype, kept **only as a reference**. Nothing here is built, tested or deployed.

- `express/` — the original Express (CommonJS) prototype: upload and text extraction for PDF/DOCX/TXT/PPTX.
  Segment 2 (document processing) may port `services/textCleaner.js` and `extractors/{pdf,docx,txt}.js`
  into `backend/src/modules/documents/`. PPTX is out of contract (SRS accepts only PDF, DOCX, TXT).

Delete this folder once Segment 2 is merged.
