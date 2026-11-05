// @last-edited: 2026-11-05 UTC+7.
// @title: decks - a written plan becomes a deck a client reads, and every number on it comes from a checked report.
// @state: JSON in, a presentation and its provenance out, both written beside the source.
// @dependencies: node:fs, node:path, ./office/pptx.js.

// WHY A SLIDE MAY NAME A FIGURE BUT NOT A NUMBER.
// A number typed into a slide is a number nobody checked, and a slide is what the customer remembers.
// A slide names a figure, the figure comes from a report that was rechecked against its rows, and a name that is not in the report stops the deck.

// WHY THE PROVENANCE IS WRITTEN BESIDE THE DECK AND NOT ON THE SLIDE.
// A slide carrying "baris 3, 7, 9 kolom Jumlah" reads as clutter to a client, and a client who cannot check the number is a client who asks the author instead.

import fs from 'node:fs';
import path from 'node:path';

import { buildDeck } from './office/pptx.js';

function figuresOf(artifact) {
  const report = artifact?.report ?? artifact;
  const figures = Array.isArray(report?.figures) ? report.figures : [];
  return new Map(figures.map((figure) => [figure.id, figure]));
}

export function deckFromFile({ source, out = null, report = null } = {}) {
  if (source === null || source === undefined || String(source).trim() === '') {
    throw new Error('deck_build needs source: the JSON file describing the deck.');
  }
  const from = path.resolve(String(source));
  let stat;
  try {
    stat = fs.statSync(from);
  } catch (error) {
    throw new Error(`no file at ${from} (${error.code ?? error.message}); write the deck as JSON and pass that path.`);
  }
  if (!stat.isFile()) throw new Error(`${from} is not a file; a folder cannot be a deck source.`);
  if (stat.size === 0) throw new Error(`${from} is zero bytes; an empty file is not a deck.`);

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(from, 'utf8'));
  } catch (error) {
    throw new Error(`deck_build needs JSON source: ${error.message}`);
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('deck_build needs a JSON object with a title and slides.');
  }
  const title = String(spec.title ?? '').trim();
  if (title === '') throw new Error('deck_build needs a title.');

  const rawSlides = Array.isArray(spec.slides) ? spec.slides : [];
  if (rawSlides.length === 0) throw new Error('deck_build needs at least one slide.');

  let figures = new Map();
  if (report !== null && report !== undefined && String(report).trim() !== '') {
    const reportPath = path.resolve(String(report));
    let plan;
    try {
      plan = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch (error) {
      throw new Error(`the report at ${reportPath} could not be read: ${error.message}`);
    }
    figures = figuresOf(plan);
  }

  const used = [];
  const slides = rawSlides.map((slide, index) => {
    const slideTitle = String(slide?.title ?? '').trim();
    if (slideTitle === '') throw new Error(`slide ${index + 1} has no title; a slide without one is a picture of nothing.`);
    const bullets = (Array.isArray(slide?.bullets) ? slide.bullets : [])
      .map((bullet) => String(bullet ?? '').trim())
      .filter((bullet) => bullet !== '');

    const figureId = slide?.figure === null || slide?.figure === undefined ? null : String(slide.figure).trim();
    if (figureId !== null && figureId !== '') {
      const figure = figures.get(figureId);
      if (!figure) {
        throw new Error(`slide ${index + 1} names the figure "${figureId}", and the report does not hold it; a slide may only show a figure the report checked.`);
      }
      bullets.push(`${figure.label}: ${figure.display}`);
      used.push({ slide: index + 1, id: figure.id, label: figure.label, display: figure.display, source: figure.source });
    }

    return { title: slideTitle, bullets };
  });

  const deck = buildDeck({ title, slides });
  const base = path.join(path.dirname(from), path.basename(from, path.extname(from)));
  const outPath = out === null || out === undefined || String(out).trim() === ''
    ? `${base}.pptx`
    : path.resolve(String(out));
  const planPath = `${base}.deck.json`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.writing`;
  fs.writeFileSync(tmp, deck);
  fs.rmSync(outPath, { force: true });
  fs.renameSync(tmp, outPath);

  const provenance = {
    source: from,
    title,
    generatedAt: new Date().toISOString(),
    slides: slides.map((slide, index) => ({ index: index + 1, title: slide.title, bullets: slide.bullets })),
    figures: used
  };
  fs.writeFileSync(planPath, `${JSON.stringify(provenance, null, 1)}\n`);

  return {
    source: from,
    out: outPath,
    plan: planPath,
    bytes: deck.length,
    slides: slides.length,
    figures: used.map((figure) => ({ slide: figure.slide, id: figure.id, display: figure.display }))
  };
}
