import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('admin QR scanner sends CSRF and safely handles non-JSON errors', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/modules/admin/pages/ScanEnquiryPage.astro'),
    'utf8',
  );

  assert.match(source, /id="scanCsrf"/, 'scanner page must expose the CSRF token');
  assert.match(source, /'x-csrf-token':/, 'QR lookup POST must send the CSRF header');
  assert.match(
    source,
    /contentType\.includes\('application\/json'\)/,
    'scanner must not assume every response is JSON',
  );
  assert.match(source, /await response\.text\(\)/, 'scanner must surface plain-text server errors');
});
