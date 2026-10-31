// @last-edited: 2026-10-30 UTC+7.
// @title: doc-render — the paper turned into styled HTML, and the chart turned into a picture.
// @state: the chart spec rules, the canvas expression, and the HTML a plan renders into.
// @dependencies: node:test, strict, ../local/doc-render.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assetKey,
  breakMarker,
  chartExpression,
  chartMarker,
  chartSpec,
  graphFigureHtml,
  paperMarkers,
  renderPaperHtml,
  tocListHtml,
  tocMarker
} from '../local/doc-render.js';

const GRAPH = {
  kind: 'bar',
  title: 'Latensi per panggilan',
  caption: 'Angka dari tabel.',
  data: [
    {
      label: 'list_tabs',
      value: 2
    },
    {
      label: 'read_page',
      value: 54
    }
  ]
};

const DOCUMENT = {
  title: 'Satu Sampel Dingin',
  docplan: {
    title: 'Satu Sampel Dingin',
    author: 'Opera Agent',
    sections: [],
    blocks: [
      {
        kind: 'heading',
        level: 1,
        text: 'Pengukuran',
        section: 0
      },
      {
        kind: 'paragraph',
        text: 'Semua angka diambil pada tab yang sama.',
        section: 0
      },
      {
        kind: 'table',
        headers: [
          'Panggilan',
          'Latensi ms'
        ],
        rows: [
          [
            'list_tabs',
            '2'
          ]
        ],
        section: 0,
        table: 0
      },
      {
        kind: 'image',
        alt: 'Tangkapan layar',
        caption: 'Tab yang dipakai.',
        src: 'shot.png',
        section: 0
      },
      {
        kind: 'graph',
        chartKind: 'bar',
        title: 'Latensi',
        caption: 'Dari tabel.',
        data: GRAPH.data,
        source: {
          section: 0,
          table: 0,
          rows: [
            0
          ]
        },
        section: 0
      }
    ],
    totals: {
      sections: 1,
      items: 1,
      images: 1,
      graphs: 1
    }
  },
  figures: []
};

const COMPLETE = {
  title: 'Paper Lengkap',
  docplan: {
    title: 'Paper Lengkap',
    author: 'Opera Agent',
    cover: {
      subtitle: 'Membaca kanvas',
      affiliation: 'Laboratorium Opera',
      date: '31 Oktober 2026',
      abstract: 'Ringkasan satu paragraf.',
      keywords: [
        'accessibility tree',
        'google docs'
      ]
    },
    toc: {
      title: 'Daftar Isi'
    },
    references: [
      'Opera Agent. 2026. Paper lengkap.'
    ],
    sections: [],
    blocks: [
      {
        kind: 'heading',
        level: 1,
        text: 'Pengantar',
        section: 0
      }
    ],
    totals: {
      sections: 1,
      items: 0,
      images: 0,
      graphs: 0
    }
  },
  figures: []
};

test('a chart of an unknown kind is refused instead of drawn as something else', () => {
  assert.throws(() => chartSpec({
    kind: 'pie',
    data: GRAPH.data
  }), /cannot be drawn/);
});

test('a chart with no data or a bad value is refused', () => {
  assert.throws(() => chartSpec({
    kind: 'bar',
    data: []
  }), /no data/);
  assert.throws(() => chartSpec({
    kind: 'bar',
    data: [
      {
        label: 'x',
        value: 'abc'
      }
    ]
  }), /non-numeric/);
});

test('the chart expression draws on a canvas and hands back a png', () => {
  const expression = chartExpression(chartSpec(GRAPH));
  assert.match(expression, /createElement\('canvas'\)/);
  assert.match(expression, /toDataURL\('image\/png'\)/);
  assert.match(expression, /read_page/);
});

test('the paper becomes a heading, a paragraph, a table, an image and a chart', () => {
  const html = renderPaperHtml({
    document: DOCUMENT,
    assets: {
      images: {
        [assetKey('image', 0, 0)]: 'data:image/png;base64,AAA'
      },
      charts: {
        [assetKey('graph', 0, 0)]: 'data:image/png;base64,BBB'
      }
    }
  });
  assert.match(html, /<p[^>]*>Satu Sampel Dingin<\/p>/, 'the title stands on its own, so a table of contents does not list the title of the paper');
  assert.match(html, /<h2[^>]*>Pengukuran<\/h2>/);
  assert.match(html, /<p[^>]*>Semua angka diambil pada tab yang sama\.<\/p>/);
  assert.match(html, /<th[^>]*>Panggilan<\/th>/);
  assert.match(html, /<td[^>]*>list_tabs<\/td>/);
  assert.match(html, /<img src="data:image\/png;base64,AAA" alt="Tangkapan layar"/);
  assert.match(html, /<img src="data:image\/png;base64,BBB" alt="Latensi"/);
  assert.match(html, /<figcaption[^>]*>Tab yang dipakai\.<\/figcaption>/);
});

test('a native chart is a marker the page can find, and no picture', () => {
  const html = renderPaperHtml({
    document: DOCUMENT,
    assets: {
      images: {
        [assetKey('image', 0, 0)]: 'data:image/png;base64,AAA'
      },
      charts: {}
    },
    nativeCharts: true
  });
  assert.match(html, /\[\[opera-chart-1\]\]/, 'the graph stands as a marker the document can find');
  assert.ok(html.includes(chartMarker(1)), 'the marker is the one the chart placer looks for');
  assert.ok(!html.includes('base64,BBB'), 'no chart picture is pasted');
  assert.match(html, /Latensi — Dari tabel\./, 'the caption stays under the chart');
});

test('a graph picture carries its title and caption under it', () => {
  const html = graphFigureHtml({
    block: GRAPH,
    src: 'data:image/png;base64,BBB'
  });
  assert.match(html, /<figure/, 'the picture stands on its own');
  assert.match(html, /Latensi per panggilan — Angka dari tabel\./, 'the caption names the graph');
  assert.match(html, /data:image\/png;base64,BBB/);
});

test('the style travels on the element, because a pasted stylesheet is not read', () => {
  const html = renderPaperHtml({
    document: DOCUMENT,
    assets: {
      images: {
        [assetKey('image', 0, 0)]: 'data:image/png;base64,AAA'
      },
      charts: {
        [assetKey('graph', 0, 0)]: 'data:image/png;base64,BBB'
      }
    }
  });
  assert.ok(!html.includes('<style'), 'no stylesheet is sent, only rules on elements');
  assert.match(html, /<h2 style="[^"]*font-size:18px/);
});

test('a picture with no source and a chart with no picture stop the render', () => {
  assert.throws(() => renderPaperHtml({
    document: DOCUMENT,
    assets: {
      charts: {
        [assetKey('graph', 0, 0)]: 'data:image/png;base64,BBB'
      }
    }
  }), /has no source to place/);
  assert.throws(() => renderPaperHtml({
    document: DOCUMENT,
    assets: {
      images: {
        [assetKey('image', 0, 0)]: 'data:image/png;base64,AAA'
      }
    }
  }), /has no picture/);
});

test('a title with markup in it is escaped before it reaches the page', () => {
  const html = renderPaperHtml({
    document: {
      docplan: {
        title: 'A <script>alert(1)</script> & co',
        blocks: []
      }
    }
  });
  assert.ok(!html.includes('<script>'), 'no markup from the title reaches the page');
  assert.match(html, /\u0026lt;script\u0026gt;/);
});

test('the cover carries the subtitle, the affiliation, the date, the abstract and the keywords', () => {
  const html = renderPaperHtml({
    document: COMPLETE
  });
  assert.match(html, /Membaca kanvas/);
  assert.match(html, /Laboratorium Opera/);
  assert.match(html, /31 Oktober 2026/);
  assert.match(html, /Abstrak/);
  assert.match(html, /Ringkasan satu paragraf\./);
  assert.match(html, /Kata kunci/);
  assert.match(html, /accessibility tree/);
});

test('the cover ends with a page break, and the contents stand between two of them', () => {
  const html = renderPaperHtml({
    document: COMPLETE
  });
  assert.ok(html.includes('[[opera-break-1]]'), 'the cover ends with a page break');
  assert.ok(html.includes('[[opera-toc]]'), 'the table of contents stands as a marker the page can replace');
  assert.ok(html.includes('[[opera-break-2]]'), 'the contents end with a page break');
  assert.match(html, /Daftar Isi/);
});

test('a paper with no cover and no contents carries no markers at all', () => {
  const html = renderPaperHtml({
    document: DOCUMENT,
    assets: {
      images: {
        [assetKey('image', 0, 0)]: 'data:image/png;base64,AAA'
      },
      charts: {
        [assetKey('graph', 0, 0)]: 'data:image/png;base64,BBB'
      }
    }
  });
  assert.ok(!html.includes('[[opera-break-1]]'));
  assert.ok(!html.includes('[[opera-toc]]'));
});

test('the references are a numbered list under their heading', () => {
  const html = renderPaperHtml({
    document: COMPLETE
  });
  assert.match(html, /<h2[^>]*>Referensi<\/h2>/);
  assert.match(html, /\[1\] Opera Agent\. 2026\. Paper lengkap\./);
});

test('the markers the writer looks for are the markers the paper carries', () => {
  assert.equal(breakMarker(1), '[[opera-break-1]]');
  assert.equal(tocMarker(), '[[opera-toc]]');
  const html = renderPaperHtml({
    document: COMPLETE
  });
  assert.ok(html.includes(breakMarker(1)));
  assert.ok(html.includes(tocMarker()));
});

test('the markers the paper asks for are the ones the writer looks for', () => {
  const markers = paperMarkers({
    document: COMPLETE
  });
  assert.deepEqual(markers.breaks, [
    '[[opera-break-1]]',
    '[[opera-break-2]]'
  ]);
  assert.equal(markers.toc, '[[opera-toc]]');
});

test('a paper with no contents asks for no table of contents', () => {
  const markers = paperMarkers({
    document: DOCUMENT
  });
  assert.deepEqual(markers.breaks, []);
  assert.equal(markers.toc, null);
});

test('the list that stands in for a contents the page will not make names every heading', () => {
  const html = tocListHtml({
    document: COMPLETE
  });
  assert.match(html, /Pengantar/);
  assert.match(html, /Referensi/);
});
