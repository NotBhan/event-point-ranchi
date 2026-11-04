import { requireAdmin } from '../../../core/auth';
import { getInt, getString, redirect } from '../../../core/http';
import { setError } from '../../../core/flash';
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
  loadCatalogueEditor,
  loadCatalogueList,
  reorderCatalogueImage,
  saveCatalogueEditor,
} from '../catalogue-service';
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

  if (ctx.request.method === 'POST') {
    const action = getString(ctx.form, 'action') || 'save';

    if (action === 'save') {
      try {
        const savedId = await saveCatalogueEditor(kind, ctx.form, id);
        return redirect(editPath(kind, savedId));
      } catch (error) {
        setError(ctx.cookies, error instanceof Error ? error.message : 'Could not save the catalogue item.');
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
  return {
    props: {
      kind,
      id: id ?? null,
      item: data?.item ?? null,
      images: data?.images ?? [],
      categories: data?.categories ?? [],
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
