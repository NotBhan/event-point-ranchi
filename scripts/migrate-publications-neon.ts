import { ensurePublicationsTable } from '../src/core/operational/publication-service';
import { getNeonClient } from '../src/core/operational/neon-client';

const client = getNeonClient();

if (!client.isUsingRemote()) {
  console.error(
    '[migrate:publications] DATABASE_URL is not set, so there is no Neon database to migrate. ' +
      'The table is created automatically on first publish for local development.',
  );
  process.exitCode = 1;
} else {
  await ensurePublicationsTable(client);
  console.log('[migrate:publications] content_publications table is ready.');
  await client.close();
}
