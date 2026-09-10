import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const popup = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../extension/styles.css', import.meta.url), 'utf8');

test('popup keeps its controls accessible and responsive in narrow Opera panels', () => {
  for (const id of [
    'statusBadge', 'deviceName', 'connection', 'lastCommand', 'visionPrivacy',
    'pairSection', 'pairCode', 'pairButton', 'pairedSection', 'privateTabButton',
    'selfTestButton', 'selfTestResult', 'unpairButton'
  ]) {
    assert.match(popup, new RegExp(`id="${id}"`));
  }

  assert.match(popup, /<dl class="details">/);
  assert.match(popup, /role="alert"/);
  assert.match(styles, /width:\s*min\(352px, 100vw\)/);
  assert.match(styles, /@media \(max-width: 239px\)/);
  assert.doesNotMatch(styles, /min-width:\s*340px/);
  assert.match(script, /ready:\s*'Connected'/);
  assert.match(script, /currentTabPrivate \? 'blocked' : 'allowed'/);
});
