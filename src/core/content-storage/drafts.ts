/**
 * Content Studio drafts for object-storage page content.
 *
 * Drafts live in Neon next to the publication pointer. They are never served to
 * the public: only a published manifest is readable through the content service.
 * Saving is revision-checked so concurrent edits conflict instead of overwriting.
 */
import { getNeonClient } from '../operational/neon-client';
import { assertContentSchema } from './publication';
import { getPointer, getPublishedPageDocument } from './read';
import { buildDocumentsFromD1 } from './export';
import { isPageId, validateContentDocument, type ContentDocument, type PageId } from './schema';

export class DraftConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftConflictError';
  }
}

export interface ContentDraft {
  pageId: PageId;
  document: ContentDocument;
  revision: number;
  baseSiteVersion: string;
  updatedBy: string;
  updatedAt: string | null;
}

interface DraftRow {
  page_id: string;
  document_json: string;
  revision: number | string;
  base_site_version: string;
  updated_by: string;
  updated_at: string | null;
}

function toDraft(row: DraftRow): ContentDraft {
  return {
    pageId: row.page_id as PageId,
    document: JSON.parse(row.document_json) as ContentDocument,
    revision: Number(row.revision),
    baseSiteVersion: row.base_site_version ?? '',
    updatedBy: row.updated_by ?? '',
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function listDrafts(): Promise<ContentDraft[]> {
  await assertContentSchema();
  const neon = getNeonClient();
  const res = await neon.query<DraftRow>('SELECT * FROM content_drafts ORDER BY page_id');
  return res.rows.map(toDraft);
}

export async function getDraft(pageId: PageId): Promise<ContentDraft | null> {
  await assertContentSchema();
  const neon = getNeonClient();
  const res = await neon.query<DraftRow>('SELECT * FROM content_drafts WHERE page_id = $1 LIMIT 1', [pageId]);
  return res.rows[0] ? toDraft(res.rows[0]) : null;
}

/**
 * The document the editor should start from: the draft if one exists, otherwise
 * the currently published version, otherwise the live D1 export.
 */
export async function getEditableDocument(pageId: PageId): Promise<ContentDocument> {
  const draft = await getDraft(pageId);
  if (draft) return draft.document;

  try {
    return await getPublishedPageDocument(pageId, { allowFallback: false });
  } catch {
    const { documents } = await buildDocumentsFromD1({ updatedBy: 'editor' });
    const document = documents.find((entry) => entry.pageId === pageId);
    if (!document) throw new Error(`No content is available for page "${pageId}".`);
    return document;
  }
}

/**
 * Saves a draft with optimistic concurrency.
 * `expectedRevision` 0 means "create"; any other value must match the stored row.
 */
export async function saveDraft(input: {
  pageId: PageId;
  document: unknown;
  expectedRevision: number;
  actor: string;
}): Promise<{ revision: number }> {
  await assertContentSchema();

  if (!isPageId(input.pageId)) throw new Error(`Unknown page id "${String(input.pageId)}".`);

  const document = validateContentDocument(input.document);
  if (document.pageId !== input.pageId) {
    throw new Error(`The submitted document is for "${document.pageId}", not "${input.pageId}".`);
  }

  const neon = getNeonClient();
  const pointer = await getPointer().catch(() => null);
  const baseSiteVersion = pointer?.siteVersion ?? '';
  const json = JSON.stringify(document);

  if (input.expectedRevision <= 0) {
    const res = await neon.query(
      `INSERT INTO content_drafts (page_id, document_json, revision, base_site_version, updated_by, updated_at)
       VALUES ($1, $2, 1, $3, $4, NOW())
       ON CONFLICT (page_id) DO NOTHING`,
      [input.pageId, json, baseSiteVersion, input.actor],
    );
    if (res.rowCount === 0) {
      throw new DraftConflictError(
        'Another administrator already created a draft for this page. Reload the editor and re-apply your changes.',
      );
    }
    return { revision: 1 };
  }

  const updated = await neon.query(
    `UPDATE content_drafts
        SET document_json = $1, revision = revision + 1, base_site_version = $2, updated_by = $3, updated_at = NOW()
      WHERE page_id = $4 AND revision = $5`,
    [json, baseSiteVersion, input.actor, input.pageId, input.expectedRevision],
  );

  if (updated.rowCount !== 1) {
    throw new DraftConflictError(
      'This page changed in another session since you loaded it. Reload the editor to see the latest draft.',
    );
  }

  return { revision: input.expectedRevision + 1 };
}

export async function deleteDraft(pageId: PageId): Promise<boolean> {
  await assertContentSchema();
  const neon = getNeonClient();
  const res = await neon.query('DELETE FROM content_drafts WHERE page_id = $1', [pageId]);
  return res.rowCount > 0;
}

/** Removes the drafts that were included in a successful publication. */
export async function clearPublishedDrafts(pageIds: PageId[]): Promise<number> {
  if (pageIds.length === 0) return 0;
  let removed = 0;
  for (const pageId of pageIds) {
    if (await deleteDraft(pageId)) removed += 1;
  }
  return removed;
}
