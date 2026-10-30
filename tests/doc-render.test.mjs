// @last-edited: 2026-10-30 UTC+7.
// @title: doc-render — the paper turned into styled HTML, and the chart turned into a picture.
// @state: the chart spec rules, the canvas expression, and the HTML a plan renders into.
// @dependencies: node:test, strict, ../local/doc-render.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assetKey,
  chartExpression,
  chartSpec,
  renderPaperHtml
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
  assert.match(html, /<h1[^>]*>Satu Sampel Dingin<\/h1>/);
  assert.match(html, /<h2[^>]*>Pengukuran<\/h2>/);
  assert.match(html, /<p[^>]*>Semua angka diambil pada tab yang sama\.<\/p>/);
  assert.match(html, /<th[^>]*>Panggilan<\/th>/);
  assert.match(html, /<td[^>]*>list_tabs<\/td>/);
  assert.match(html, /<img src="data:image\/png;base64,AAA" alt="Tangkapan layar"/);
  assert.match(html, /<img src="data:image\/png;base64,BBB" alt="Latensi"/);
  assert.match(html, /<figcaption[^>]*>Tab yang dipakai\.<\/figcaption>/);
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
