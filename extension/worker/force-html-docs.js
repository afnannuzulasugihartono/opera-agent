// @last-edited: 2026-10-14 UTC+7.
// @title: force-html-docs — ask Google Docs for its HTML renderer instead of canvas.
// @state: one MAIN-world assignment at document_start; Docs reads the flag at boot.
// @dependencies: none.

// WHY HTML INSTEAD OF CANVAS. Docs paints document content on canvas, which no
// DOM reader can see: text, tables, and notes are all invisible to reads,
// finds, and verification. Setting this flag before Docs boots selects the
// HTML renderer, where the same content is ordinary readable DOM. Runs in the
// MAIN world because an isolated content script cannot touch page globals.

window._docs_force_html_by_ext = chrome.runtime.id;
