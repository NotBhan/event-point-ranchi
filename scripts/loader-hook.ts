import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.sql?raw') || url.endsWith('.sql')) {
      const sql = readFileSync(fileURLToPath(url), 'utf8');
      return {
        format: 'module',
        source: `export default ${JSON.stringify(sql)};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
