// @last-edited: 2026-11-05 UTC+7.
// @title: markdown — the guide can leave as Markdown, the way an AI harness wants it.
// @state: one builder over the guide article and one listener on the copy button; it writes the clipboard and moves no node.
// @dependencies: none.

// WHY THIS SCRIPT IS ITS OWN FILE: the guide is the page a reader pastes into an AI harness, and the conversion is a behaviour, not a paragraph of copy.
// WHY THE BUILDER IS PUBLIC: a check must be able to read the Markdown without clicking a button, so the builder answers under one name.

// WHY THE INLINE FORM: links, code, and emphasis keep their meaning in Markdown, and a guide that loses its links is a worse guide.

const join = (parts) => {
  let text = '';

  for (const part of parts) {
    if (!part) continue;
    const tight = /^[.,;:!?)\]}]/.test(part) || /[(\[{]$/.test(text);
    if (text && !/\s$/.test(text) && !/^\s/.test(part) && !tight) text += ' ';
    text += part;
  }

  return text;
};

const inline = (node) => {
  if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  if (node.getAttribute('aria-hidden') === 'true') return '';

  const text = join([...node.childNodes].map(inline));
  const tag = node.tagName.toLowerCase();

  if (tag === 'a') return `[${text.trim()}](${node.getAttribute('href') || ''})`;
  if (tag === 'code' || tag === 'kbd') return `\`${text.trim()}\``;
  if (tag === 'strong' || tag === 'b') return `**${text.trim()}**`;
  if (tag === 'em' || tag === 'i') return `*${text.trim()}*`;
  if (tag === 'br') return '\n';

  return text;
};

const block = (node) => {
  const tag = node.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inline(node).trim()}`;

  if (tag === 'p') return inline(node).trim();

  if (tag === 'pre') {
    const code = node.querySelector('code');
    const language = (code?.className || '').replace(/.*language-([\w-]+).*/, '$1');
    const text = (code || node).textContent.replace(/^\n+|\n+$/g, '');
    return `\`\`\`${language}\n${text}\n\`\`\``;
  }

  if (tag === 'ul' || tag === 'ol') {
    return [...node.children]
      .filter((item) => item.tagName === 'LI')
      .map((item, index) => `${tag === 'ol' ? `${index + 1}.` : '-'} ${inline(item).trim()}`)
      .join('\n');
  }

  if (tag === 'details') {
    const summary = node.querySelector('summary');
    const body = [...node.children].filter((child) => child.tagName !== 'SUMMARY').map(block).filter(Boolean).join('\n\n');
    return `${summary ? `### ${inline(summary).trim()}` : ''}\n${body}`.trim();
  }

  if (tag === 'div' && node.classList.contains('copybox')) {
    const pre = node.querySelector('pre');
    return pre ? block(pre) : '';
  }

  return '';
};

const build = () => {
  const article = document.querySelector('.docBody');
  if (!article) return '';

  const chunks = [];

  const walk = (node) => {
    for (const child of node.children) {
      if (child.hasAttribute('data-md-tools')) continue;
      const text = block(child);
      if (text) chunks.push(text);
      else walk(child);
    }
  };

  walk(article);
  return chunks.join('\n\n');
};

for (const button of document.querySelectorAll('[data-md-copy]')) {
  button.addEventListener('click', async () => {
    const markdown = build();
    if (!markdown) return;

    const label = button.textContent;

    try {
      await navigator.clipboard.writeText(markdown);
    } catch (error) {
      // WHY THE FALLBACK: the clipboard needs a secure context, and a plain http page has none, so the text is selected and copied the old way instead of lost.
      const area = document.createElement('textarea');
      area.value = markdown;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }

    button.textContent = 'Tersalin';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = label;
      button.classList.remove('copied');
    }, 1600);
  });
}

window.OperaAgentMarkdown = { build };
