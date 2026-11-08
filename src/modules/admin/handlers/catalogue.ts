import { requireAdmin } from '../../../core/auth';
import { getInt, getString, json, redirect } from '../../../core/http';
import { setError, setSuccess } from '../../../core/flash';
import type { PageContext } from '../../../core/types';
import type { CatalogueKind } from '../../../core/content/catalogue-admin-store';
import {
  activateCatalogue,
  addCatalogueGalleryImage,
  archiveCatalogue,
  catalogueBasePath,
  deleteCatalogueImage,
  draftCatalogue,
  duplicateCatalogue,
  editCatalogueImage,
  getNextCatalogueOrder,
  loadCatalogueEditor,
  loadCatalogueList,
  reorderCatalogueImage,
  saveCatalogueEditor,
} from '../catalogue-service';
import { listCatalogueCategories } from '../../../core/content/catalogue-admin-store';
import { runFormAction } from './shared';

function editPath(kind: CatalogueKind, id: number): string {
  return `${catalogueBasePath(kind)}/${id}`;
}

export async function catalogueList(ctx: PageContext, kind: CatalogueKind) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return { props: await loadCatalogueList(kind, ctx.url) };
}

export async function catalogueForm(ctx: PageContext, kind: CatalogueKind) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const rawId = ctx.params.id;
  const id = rawId && rawId !== 'new' ? Number(rawId) : undefined;
  const wantsJson = ctx.request.headers.get('accept')?.includes('application/json') ?? false;

  if (ctx.request.method === 'POST') {
    const action = getString(ctx.form, 'action') || 'save';
    const singular = kind === 'mandaps' ? 'Mandap' : kind === 'stages' ? 'Stage' : 'Equipment item';

    if (action === 'save') {
      try {
        const savedId = await saveCatalogueEditor(kind, ctx.form, id);
        const destination = editPath(kind, savedId);
        const message = id ? `${singular} updated successfully.` : `${singular} created successfully.`;
        setSuccess(ctx.cookies, message);
        if (wantsJson) {
          return json({
            status: 'ok',
            message,
            data: { id: savedId, redirect: destination },
          });
        }
        return redirect(destination);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save the catalogue item.';
        console.error(`[catalogueForm] Error saving ${kind}:`, error);
        setError(ctx.cookies, message);
        if (wantsJson) {
          return json({ status: 'error', message }, 400);
        }
        return redirect(id ? editPath(kind, id) : `${catalogueBasePath(kind)}/new`);
      }
    }

    if (!id) return redirect(catalogueBasePath(kind));
    return runFormAction(
      ctx,
      {
        archive: () => archiveCatalogue(kind, id),
        activate: () => activateCatalogue(kind, id),
        draft: () => draftCatalogue(kind, id),
        duplicate: () => duplicateCatalogue(kind, id),
        add_image: () => addCatalogueGalleryImage(kind, id, ctx.form),
        edit_image: () => editCatalogueImage(kind, ctx.form),
        delete_image: () => deleteCatalogueImage(kind, getInt(ctx.form, 'image_id')),
        reorder_image: () => reorderCatalogueImage(kind, ctx.form),
      },
      { redirectTo: editPath(kind, id) },
    );
  }

  const data = id ? await loadCatalogueEditor(kind, id) : null;
  if (id && !data) return { props: { notFound: true }, status: 404 };
  const categories = data?.categories ?? (await listCatalogueCategories(kind));
  const nextOrder = id ? Number(data?.item?.sort_order ?? 0) : await getNextCatalogueOrder(kind);
  return {
    props: {
      kind,
      id: id ?? null,
      item: data?.item ?? null,
      images: data?.images ?? [],
      categories,
      nextOrder,
    },
  };
}

export function catalogueAction(ctx: PageContext, kind: CatalogueKind) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const id = Number(ctx.params.id);
  return runFormAction(
    ctx,
    {
      archive: () => archiveCatalogue(kind, id),
      activate: () => activateCatalogue(kind, id),
      draft: () => draftCatalogue(kind, id),
      duplicate: () => duplicateCatalogue(kind, id),
    },
    { redirectTo: catalogueBasePath(kind) },
  );
}
