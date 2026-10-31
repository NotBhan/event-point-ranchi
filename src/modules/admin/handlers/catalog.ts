import { requireAdmin, requireEditor } from '../../../core/auth';
import { getInt, getString, parsePageParams, redirect } from '../../../core/http';
import type { PageContext } from '../../../core/types';
import {
  saveSiteSettings,
  saveSeoSettings,
  addGalleryCategory,
  addGuestPricing,
  addHomeFeature,
  addMenuItem,
  addMenuSection,
  addPackageOption,
  batchUploadGalleryAdmin,
  deleteCatering,
  deleteGalleryCategory,
  deleteGalleryItem,
  deleteGuestPricing,
  deleteHall,
  deleteHomeFeature,
  deleteMenuItem,
  deleteMenuSection,
  deletePackageOption,
  listCateringAdmin,
  listGalleryAdmin,
  listHallsAdmin,
  loadCateringAdmin,
  loadContentAdmin,
  parseContentStudioTab,
  loadHallAdmin,
  replaceGalleryItemAdmin,
  saveCatering,
  saveContactInfo,
  saveGalleryItemCategory,
  saveGalleryItemTitle,
  saveHall,
  saveHomepage,
  saveMandapLocationAdmin,
  savePageAdmin,
  savePageSettings,
  saveVideoPreviewAdmin,
  deleteVideoPreviewAdmin,
  toggleVideoPreviewAdmin,
  toggleCatering,
  toggleCateringHome,
  toggleGalleryCategory,
  toggleGalleryItem,
  toggleHall,
  toggleMenuItem,
  updateMenuItem,
  updateMenuSection,
} from '../service';
import { runFormAction } from './shared';

/* ---------------- Halls ---------------- */

export function hallsList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });
  return { props: { ...listHallsAdmin({ page, perPage }) } };
}

export async function hallForm(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const rawId = ctx.params.id;
  const id = rawId && rawId !== 'new' ? Number(rawId) : undefined;

  if (ctx.request.method === 'POST') {
    const action = getString(ctx.form, 'action');

    if (action === 'delete' && id) {
      deleteHall(id);
      return runFormAction(ctx, { delete: () => undefined }, { redirectTo: '/admin/halls' });
    }

    try {
      const savedId = await saveHall(ctx.form, id);
      return redirect(`/admin/halls/${savedId}`);
    } catch (error) {
      const { setError } = await import('../../../core/flash');
      setError(ctx.cookies, error instanceof Error ? error.message : 'Could not save the hall.');
      return redirect(id ? `/admin/halls/${id}` : '/admin/halls/new');
    }
  }

  const hall = id ? loadHallAdmin(id) : null;
  if (id && !hall) return { props: { notFound: true }, status: 404 };

  return { props: { hall, id: id ?? null } };
}

export function hallToggle(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return runFormAction(ctx, { toggle: () => toggleHall(Number(ctx.params.id)) }, { redirectTo: '/admin/halls' });
}

export function hallDelete(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return runFormAction(ctx, { delete: () => deleteHall(Number(ctx.params.id)) }, { redirectTo: '/admin/halls' });
}

/* ---------------- Catering ---------------- */

export function cateringList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });
  return { props: { ...listCateringAdmin({ page, perPage }) } };
}

export async function cateringForm(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const rawId = ctx.params.id;
  const id = rawId && rawId !== 'new' ? Number(rawId) : undefined;
  const { setError } = await import('../../../core/flash');

  if (ctx.request.method === 'POST') {
    const action = getString(ctx.form, 'action');

    if (action === 'save' || !action) {
      try {
        const savedId = await saveCatering(ctx.form, id);
        return redirect(`/admin/catering/${savedId}`);
      } catch (error) {
        setError(ctx.cookies, error instanceof Error ? error.message : 'Could not save the package.');
        return redirect(id ? `/admin/catering/${id}` : '/admin/catering/new');
      }
    }

    if (!id) return redirect('/admin/catering');

    const back = `/admin/catering/${id}`;
    return runFormAction(
      ctx,
      {
        add_section: () => addMenuSection(id, ctx.form),
        update_section: () => updateMenuSection(getInt(ctx.form, 'section_id'), ctx.form),
        delete_section: () => deleteMenuSection(getInt(ctx.form, 'section_id')),
        add_item: () => addMenuItem(getInt(ctx.form, 'section_id'), ctx.form),
        update_item: () => updateMenuItem(getInt(ctx.form, 'item_id'), ctx.form),
        delete_item: () => deleteMenuItem(getInt(ctx.form, 'item_id')),
        toggle_item: () => toggleMenuItem(getInt(ctx.form, 'item_id')),
        add_pricing: () => addGuestPricing(id, ctx.form),
        delete_pricing: () => deleteGuestPricing(getInt(ctx.form, 'pricing_id')),
        add_feature: () => addPackageOption('catering_features', id, ctx.form),
        delete_feature: () => deletePackageOption('catering_features', getInt(ctx.form, 'feature_id')),
        add_banner_feature: () => addPackageOption('banner_features', id, ctx.form),
        delete_banner_feature: () => deletePackageOption('banner_features', getInt(ctx.form, 'feature_id')),
        toggle: () => toggleCatering(id),
        toggle_home: () => toggleCateringHome(id),
      },
      { redirectTo: back },
    );
  }

  const data = id ? loadCateringAdmin(id) : null;
  if (id && !data) return { props: { notFound: true }, status: 404 };
  return {
    props: {
      packageData: data?.package ?? null,
      features: data?.features ?? [],
      bannerFeatures: data?.bannerFeatures ?? [],
      pricing: data?.pricing ?? [],
      sections: data?.sections ?? [],
      id: id ?? null,
    },
  };
}

export function cateringListAction(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const id = getInt(ctx.form, 'id');
  return runFormAction(
    ctx,
    {
      toggle: () => toggleCatering(id),
      toggle_home: () => toggleCateringHome(id),
      delete: () => deleteCatering(id),
    },
    { redirectTo: '/admin/catering' },
  );
}

/* ---------------- Gallery ---------------- */

export function galleryAdmin(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  if (ctx.request.method === 'POST') {
    return runFormAction(
      ctx,
      {
        add_category: () => addGalleryCategory(ctx.form),
        delete_category: () => deleteGalleryCategory(getInt(ctx.form, 'category_id')),
        toggle_category: () => ({ active: toggleGalleryCategory(getInt(ctx.form, 'category_id')) }),
        add_item: () => batchUploadGalleryAdmin(ctx.form),
        replace_item: () => replaceGalleryItemAdmin(getInt(ctx.form, 'item_id'), ctx.form),
        save_item_title: () => ({ title: saveGalleryItemTitle(getInt(ctx.form, 'item_id'), ctx.form) }),
        change_item_category: () => ({ categoryId: saveGalleryItemCategory(getInt(ctx.form, 'item_id'), ctx.form) }),
        delete_item: () => deleteGalleryItem(getInt(ctx.form, 'item_id')),
        toggle_item: () => ({ active: toggleGalleryItem(getInt(ctx.form, 'item_id')) }),
      },
      { redirectTo: '/admin/gallery' },
    );
  }

  const page = Math.max(1, parseInt(ctx.url.searchParams.get('page') || '1', 10) || 1);
  const categoryId = parseInt(ctx.url.searchParams.get('category') || '0', 10) || 0;
  return { props: listGalleryAdmin({ page, perPage: 18, categoryId }) };
}

/* ---------------- Content ---------------- */

function contentTabFromRequest(ctx: PageContext) {
  const explicit = ctx.url.searchParams.get('tab');
  if (explicit) return parseContentStudioTab(explicit);

  // Forms post without a tab param; keep the editor on the tab they submitted
  // from by reading it back from the referer.
  const referer = ctx.request.headers.get('referer');
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (refUrl.pathname === '/admin/content') {
        return parseContentStudioTab(refUrl.searchParams.get('tab'));
      }
    } catch {
      /* ignore malformed referer */
    }
  }
  return parseContentStudioTab(null);
}

export async function contentAdmin(ctx: PageContext) {
  const denied = requireEditor(ctx);
  if (denied) return denied;

  if (ctx.request.method === 'POST') {
    return runFormAction(
      ctx,
      {
        save_homepage: () => saveHomepage(ctx.form),
        add_feature: () => addHomeFeature(ctx.form),
        delete_feature: () => deleteHomeFeature(getInt(ctx.form, 'feature_id')),
        save_page: () => savePageSettings(ctx.form),
        save_contact: () => saveContactInfo(ctx.form),
        save_site_settings: () => saveSiteSettings(ctx.form),
        save_seo: () => saveSeoSettings(ctx.form),
        save_page_content: () => savePageAdmin(ctx.form),
        save_mandap_location: () => saveMandapLocationAdmin(ctx.form),
        save_video_preview: () => saveVideoPreviewAdmin(ctx.form),
        delete_video_preview: () => deleteVideoPreviewAdmin(ctx.form),
        toggle_video_preview: () => toggleVideoPreviewAdmin(ctx.form),
      },
      { redirectTo: `/admin/content?tab=${contentTabFromRequest(ctx)}` },
    );
  }

  const tab = parseContentStudioTab(ctx.url.searchParams.get('tab'));
  const content = await loadContentAdmin(tab);
  return { props: content };
}
