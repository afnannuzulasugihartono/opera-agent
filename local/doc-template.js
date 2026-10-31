// @last-edited: 2026-10-31 UTC+7.
// @title: doc-template — the looks a paper may ask for: one named template, and the plain look a paper has without one.
// @state: the names a paper may name, and the style, labels and wording each name gives the renderer.
// @dependencies: none.

// WHY THE RULES ARE THE RULES OF THE CLASS.
// The template is Overleaf's Basic Academic Journal Article Template, whose class is olplainarticle.cls.
// That class sets a 20pt bold sans title, a Helvetica bold 12pt author, an abstract in a box filled RGB(182,193,251), a Times 10pt body, section headings in bold sans capitals, captions labelled in bold sans, and references numbered as a bold superscript.
// So every rule below is that class's rule, read from the class, and not a taste of ours.

export const PAPER_TEMPLATES = [
  'journal'
];

// WHY A POINT IS WRITTEN AS A POINT AND NOT AS A PIXEL.
// A Google Doc reads the size of a pasted run as a point, and a point is 1/72 inch while a pixel is 1/96 inch.
// So a 20pt title is written as 26.67px and a 10pt body as 13.33px, because that is what the class asks for.

const PLAIN = {
  name: 'plain',
  boxedAbstract: false,
  superscriptReferences: false,
  contentsNumbers: true,
  headingText: (text) => text,
  labels: {
    abstract: 'Abstrak',
    keywords: 'Kata kunci:',
    table: '',
    figure: ''
  },
  styles: {
    title: 'font-family:Arial, sans-serif;font-size:26px;font-weight:bold;color:#0b57d0;text-align:center;margin:48px 0 6px 0',
    subtitle: 'font-family:Arial, sans-serif;font-size:12px;color:#202124;text-align:center;margin:0 0 4px 0',
    author: 'font-family:Arial, sans-serif;font-size:12px;color:#202124;text-align:center;margin:0 0 4px 0',
    affiliation: 'font-family:Arial, sans-serif;font-size:12px;color:#202124;text-align:center;margin:0 0 4px 0',
    date: 'font-family:Arial, sans-serif;font-size:12px;color:#202124;text-align:center;margin:0 0 4px 0',
    label: 'font-family:Arial, sans-serif;font-size:12px;font-weight:bold;color:#202124;text-align:left;margin:18px 0 4px 0',
    heading: 'font-family:Arial, sans-serif;font-size:18px;font-weight:bold;color:#202124;border-bottom:1px solid #dadce0;padding-bottom:4px;margin:22px 0 10px 0',
    body: 'font-family:Arial, sans-serif;font-size:12px;line-height:1.55;color:#202124;margin:0 0 10px 0',
    table: 'border-collapse:collapse;width:100%;margin:0 0 14px 0',
    cell: 'border:1px solid #dadce0;padding:6px 8px;font-family:Arial, sans-serif;font-size:12px;color:#202124',
    head: 'border:1px solid #dadce0;padding:6px 8px;font-family:Arial, sans-serif;font-size:12px;color:#202124;background-color:#e8f0fe;font-weight:bold',
    ruleTop: '',
    ruleMiddle: '',
    ruleBottom: '',
    caption: 'font-family:Arial, sans-serif;font-size:11px;color:#5f6368;margin:0 0 10px 0',
    captionLabel: '',
    figureCaption: 'font-family:Arial, sans-serif;font-size:11px;color:#5f6368;margin-top:6px',
    reference: 'font-family:Arial, sans-serif;font-size:11px;line-height:1.5;color:#202124;margin:0 0 6px 0',
    referenceLabel: '',
    tocEntry: 'font-family:Arial, sans-serif;font-size:12px;line-height:1.55;color:#202124;margin:0 0 6px 0',
    abstractBox: '',
    abstractCell: '',
    abstractText: '',
    keywords: 'font-family:Arial, sans-serif;font-size:12px;font-weight:bold;color:#202124;text-align:left;margin:18px 0 4px 0'
  }
};

const JOURNAL = {
  name: 'journal',
  boxedAbstract: true,
  superscriptReferences: true,
  contentsNumbers: false,
  headingText: (
    text,
    number
  ) => number === null ? text.toUpperCase() : `${number} ${text.toUpperCase()}`,
  labels: {
    abstract: 'ABSTRACT',
    keywords: 'Keywords:',
    table: 'Table',
    figure: 'Figure'
  },
  styles: {
    title: 'font-family:Arial, sans-serif;font-size:26.67px;font-weight:bold;color:#000000;text-align:left;margin:0 0 10px 0',
    subtitle: 'font-family:Arial, sans-serif;font-size:16px;color:#000000;text-align:left;margin:0 0 6px 0',
    author: 'font-family:Arial, sans-serif;font-size:16px;font-weight:bold;color:#000000;text-align:left;margin:0 0 4px 0',
    affiliation: 'font-family:Arial, sans-serif;font-size:13.33px;font-weight:bold;color:#000000;text-align:left;margin:0 0 4px 0',
    date: 'font-family:Arial, sans-serif;font-size:13.33px;color:#000000;text-align:left;margin:0 0 4px 0',
    label: 'font-family:Arial, sans-serif;font-size:16px;font-weight:bold;color:#000000;text-align:left;margin:18px 0 6px 0',
    heading: 'font-family:Arial, sans-serif;font-size:16px;font-weight:bold;color:#000000;text-align:left;margin:18px 0 6px 0',
    body: 'font-family:Times New Roman, serif;font-size:13.33px;line-height:1.2;color:#000000;margin:0 0 10px 0',
    table: 'border-collapse:collapse;width:100%;margin:0 0 14px 0',
    cell: 'padding:4px 6px;font-family:Times New Roman, serif;font-size:13.33px;color:#000000',
    head: 'padding:4px 6px;font-family:Times New Roman, serif;font-size:13.33px;color:#000000;font-weight:bold',
    ruleTop: 'border-top:1.5px solid #000000',
    ruleMiddle: 'border-bottom:0.75px solid #000000',
    ruleBottom: 'border-bottom:1.5px solid #000000',
    caption: 'font-family:Times New Roman, serif;font-size:13.33px;color:#000000;text-align:left;margin:0 0 6px 0',
    captionLabel: 'font-family:Arial, sans-serif;font-weight:bold',
    figureCaption: 'font-family:Times New Roman, serif;font-size:13.33px;color:#000000;text-align:left;margin-top:6px',
    reference: 'font-family:Times New Roman, serif;font-size:13.33px;line-height:1.2;color:#000000;margin:0 0 4px 0;padding-left:20px;text-indent:-20px',
    referenceLabel: 'font-weight:bold;color:#000000',
    tocEntry: 'font-family:Arial, sans-serif;font-size:12px;font-weight:bold;color:#000000;margin:0 0 4px 0',
    abstractBox: 'border-collapse:collapse;width:100%;margin:0 0 18px 0',
    abstractCell: 'border:1px solid #000000;background-color:#b6c1fb;padding:8px 10px',
    abstractText: 'font-family:Arial, sans-serif;font-size:12px;line-height:1.4;color:#000000;margin:0',
    keywords: 'font-family:Times New Roman, serif;font-size:13.33px;color:#000000;margin:0 0 4px 0'
  }
};

/**
 * The look a paper asks for, by name.
 * @param {string|null} name - the template the paper names, or nothing for the plain look.
 * @returns {object} the style, labels and wording the renderer gives that paper.
 */

export function paperTemplate(name) {
  const key = typeof name === 'string' ? name.trim() : '';
  if (key === '') return PLAIN;
  if (key === 'journal') return JOURNAL;
  throw new Error(`the template "${key}" is not one this renderer knows: ${PAPER_TEMPLATES.join(', ')}.`);
}
