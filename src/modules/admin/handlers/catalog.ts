import { requireAdmin, requireEditor } from '../../../core/auth';
import { getInt, getString, json, parsePageParams, redirect } from '../../../core/http';
import { setError, setSuccess } from '../../../core/flash';
import {
  createPublication,
  deployHookConfigured,
  markDeploying,
  markFailed,
  triggerDeployHook,
  validatePublishReadiness,
} from '../../../core/operational/publication-service';
import { syncRuntimeToBuildD1 } from '../../../core/content/d1-sync';
import { getNextCateringOrder } from '../../../core/content/catalog-store';
import { buildDocumentsFromD1 } from '../../../core/content-storage/export';
import {
  clearPublishedDrafts,
  deleteDraft,
  saveDraft,
  listDrafts as listDraftsForPublish,
  DraftConflictError,
  getEditableDocument,
} from '../../../core/content-storage/drafts';
import { isPageId, type PageId } from '../../../core/content-storage/schema';
import {
  getActivePointer,
  publishContent,
  rollbackContent,
} from '../../../core/content-storage/publication';
import type { PageContext } from '../../../core/types';
import {
  saveSiteSettings,
  saveSeoSettings,
  activateCatering,
  addCateringImage,
  archiveCatering,
  addGalleryCategory,
  addGuestPricing,
  addHomeFeature,
  addMenuItem,
  addMenuSection,
  addPackageOption,
  batchUploadGalleryAdmin,
  deleteCateringImage,
  deleteGalleryCategory,
  deleteGalleryItem,
  deleteGuestPricing,
  deleteHomeFeature,
  deleteMenuItem,
  deleteMenuSection,
  deletePackageOption,
  listCateringAdmin,
  listGalleryAdmin,
  loadCateringAdmin,
  loadContentAdmin,
  moveCateringImage,
  moveMenuItem,
  parseContentStudioTab,
  replaceGalleryItemAdmin,
  saveCatering,
  saveContactInfo,
  saveGalleryItemCategory,
  saveGalleryItemTitle,
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
  toggleMenuItem,
  updateCateringImageAlt,
  updateGuestPricing,
  updateMenuItem,
  updateMenuSection,
} from '../service';
import { runFormAction } from './shared';

/* ---------------- Catering ---------------- */

export async function cateringList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });
  return { props: { ...(await listCateringAdmin({ page, perPage })) } };
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
        move_item_up: () => moveMenuItem(getInt(ctx.form, 'item_id'), -1),
        move_item_down: () => moveMenuItem(getInt(ctx.form, 'item_id'), 1),
        add_pricing: () => addGuestPricing(id, ctx.form),
        update_pricing: () => updateGuestPricing(getInt(ctx.form, 'pricing_id'), ctx.form),
        delete_pricing: () => deleteGuestPricing(getInt(ctx.form, 'pricing_id')),
        add_image: () => addCateringImage(id, ctx.form),
        update_image_alt: () => updateCateringImageAlt(getInt(ctx.form, 'image_id'), ctx.form),
        delete_image: () => deleteCateringImage(getInt(ctx.form, 'image_id')),
        move_image_up: () => moveCateringImage(getInt(ctx.form, 'image_id'), -1),
        move_image_down: () => moveCateringImage(getInt(ctx.form, 'image_id'), 1),
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

  const data = id ? await loadCateringAdmin(id) : null;
  if (id && !data) return { props: { notFound: true }, status: 404 };
  const nextOrder = id ? Number(data?.package?.sort_order ?? 0) : await getNextCateringOrder();
  return {
    props: {
      packageData: data?.package ?? null,
      features: data?.features ?? [],
      bannerFeatures: data?.bannerFeatures ?? [],
      pricing: data?.pricing ?? [],
      sections: data?.sections ?? [],
      images: data?.images ?? [],
      id: id ?? null,
      nextOrder,
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
      archive: () => archiveCatering(id),
      activate: () => activateCatering(id),
    },
    { redirectTo: '/admin/catering' },
  );
}

/* ---------------- Gallery ---------------- */

export async function galleryAdmin(ctx: PageContext) {
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
  return { props: await listGalleryAdmin({ page, perPage: 18, categoryId }) };
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

const PUBLISH_REDIRECT = '/admin/content?tab=publish';

/**
 * Validates live D1 content, records the publication in Neon and triggers the
 * Vercel deploy hook. Publishing is admin-only and never fires for autosaves.
 */
async function publishChangesAction(ctx: PageContext): Promise<Response> {
  const wantsJson = ctx.request.headers.get('accept')?.includes('application/json') ?? false;

  if (!ctx.adminAuth.isAdmin) {
    return wantsJson
      ? json({ status: 'error', message: 'Administrator access is required to publish.' }, 403)
      : redirect('/admin/login');
  }

  try {
    if (!deployHookConfigured()) {
      throw new Error(
        'Publishing is not configured on this server. Set VERCEL_DEPLOY_HOOK_URL before publishing.',
      );
    }

    const manifest = await validatePublishReadiness();

    // Synchronize live runtime D1 tables to the dedicated build D1 (CONTENT_BUILD_D1_*)
    const syncResult = await syncRuntimeToBuildD1();
    if ('skipped' in syncResult) {
      console.log(`[publish] ${syncResult.reason}`);
    } else {
      console.log(
        `[publish] Synchronized ${syncResult.totalRows} rows across ${Object.keys(syncResult.tableCounts).length} tables to build D1 in ${syncResult.durationMs}ms`,
      );
    }

    const created = await createPublication({
      requestedBy: ctx.adminAuth.user?.id ?? null,
      requestedByName: ctx.adminAuth.user?.firstName || ctx.adminAuth.user?.username || 'Administrator',
      requestedVersion: manifest.contentVersion,
    });

    if (!created.created || !created.publication) {
      throw new Error('A publication is already in progress. Wait for it to finish before publishing again.');
    }

    let hookStatus: number;
    try {
      hookStatus = await triggerDeployHook();
      await markDeploying(created.publication.id, { deployHookStatus: hookStatus });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The deploy hook could not be triggered.';
      await markFailed(created.publication.id, message);
      throw new Error(message);
    }

    const message = `Publication started for content version ${manifest.contentVersion}. The status updates here once Vercel reports the deployment.`;
    return wantsJson
      ? json({ status: 'ok', data: { publicationId: created.publication.id, contentVersion: manifest.contentVersion } })
      : (setSuccess(ctx.cookies, message), redirect(PUBLISH_REDIRECT));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publishing failed.';
    return wantsJson
      ? json({ status: 'error', message }, 400)
      : (setError(ctx.cookies, message), redirect(PUBLISH_REDIRECT));
  }
}



/** Builds the edited document from the submitted form, merged onto the base. */
function documentFromForm(base: Awaited<ReturnType<typeof getEditableDocument>>, form: FormData): unknown {
  const text = (name: string) => getString(form, name);

  if (base.pageId === 'site') {
    const sections = [...base.homepageSections];
    const heroIndex = sections.findIndex((section) => section.sectionKey === 'hero');
    if (heroIndex >= 0) {
      sections[heroIndex] = {
        ...sections[heroIndex],
        title: text('hero_title') || sections[heroIndex].title,
        subtitle: text('hero_subtitle') || sections[heroIndex].subtitle,
      };
    }
    const promoIndex = sections.findIndex((section) => section.sectionKey === 'promo_banner');
    if (promoIndex >= 0) {
      sections[promoIndex] = {
        ...sections[promoIndex],
        badge: text('promo_badge'),
        title: text('promo_headline'),
        description: text('promo_description'),
        ctaLabel: text('promo_cta_label'),
        ctaUrl: text('promo_cta_url'),
      };
    }

    return {
      ...base,
      updatedAt: new Date().toISOString(),
      settings: {
        ...base.settings,
        name: text('settings_name') || base.settings.name,
        tagline: text('settings_tagline'),
        phone: text('settings_phone'),
        email: text('settings_email'),
        address: text('settings_address'),
        footerText: text('settings_footer_text'),
      },
      homepageSections: sections,
    };
  }

  const sections: typeof base.sections = [];
  for (let index = 0; index < 6; index += 1) {
    const id = text(`section_id_${index}`);
    if (!id) continue;
    sections.push({
      id,
      heading: text(`section_heading_${index}`),
      subheading: text(`section_subheading_${index}`),
      description: text(`section_description_${index}`),
    });
  }

  return {
    ...base,
    updatedAt: new Date().toISOString(),
    title: text('title') || base.title,
    subtitle: text('subtitle'),
    description: text('description'),
    seo: {
      ...base.seo,
      metaTitle: text('meta_title') || base.title,
      metaDescription: text('meta_description'),
      canonicalUrl: text('canonical_url') || base.path,
      robots: text('robots') || base.seo.robots,
    },
    sections,
  };
}

async function saveContentDraftAction(ctx: PageContext): Promise<Response> {
  if (!ctx.adminAuth.isEditor && !ctx.adminAuth.isAdmin) {
    setError(ctx.cookies, 'You do not have permission to edit content.');
    return redirect(CONTENT_PUBLISH_REDIRECT);
  }

  const pageIdRaw = getString(ctx.form, 'page_id');
  const pageId: PageId = isPageId(pageIdRaw) ? pageIdRaw : 'home';
  const expectedRevision = getInt(ctx.form, 'revision', 0);
  const target = `/admin/content?tab=documents&page=${pageId}`;

  try {
    const base = await getEditableDocument(pageId);
    const document = documentFromForm(base, ctx.form!);
    const saved = await saveDraft({
      pageId,
      document,
      expectedRevision,
      actor: ctx.adminAuth.user?.username ?? 'admin',
    });
    setSuccess(ctx.cookies, `Draft saved (revision ${saved.revision}). It is not published yet.`);
  } catch (error) {
    setError(
      ctx.cookies,
      error instanceof DraftConflictError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The draft could not be saved.',
    );
  }

  return redirect(target);
}

async function discardContentDraftAction(ctx: PageContext): Promise<Response> {
  const pageIdRaw = getString(ctx.form, 'page_id');
  const pageId: PageId = isPageId(pageIdRaw) ? pageIdRaw : 'home';
  await deleteDraft(pageId).catch(() => false);
  setSuccess(ctx.cookies, 'Draft discarded.');
  return redirect(`/admin/content?tab=documents&page=${pageId}`);
}

const CONTENT_PUBLISH_REDIRECT = '/admin/content?tab=publish';

/**
 * Publishes the current content to the immutable object store and moves the
 * active pointer. Admin-only: the publish tab is already admin-gated, and this
 * is the write path that makes a version live.
 */
async function publishObjectStoreAction(ctx: PageContext): Promise<Response> {
  if (!ctx.adminAuth.isAdmin) {
    setError(ctx.cookies, 'Only administrators can publish content.');
    return redirect(CONTENT_PUBLISH_REDIRECT);
  }

  const actor = { id: ctx.adminAuth.user?.id ?? null, name: ctx.adminAuth.user?.username ?? 'admin' };

  try {
    const { documents } = await buildDocumentsFromD1({ updatedBy: actor.name });

    // Drafts win over the D1 export: the editor's saved work is what gets published.
    const drafts = await listDraftsForPublish();
    const overlay = new Map(drafts.map((draft) => [draft.pageId, draft.document]));
    const merged = documents.map((document) => overlay.get(document.pageId) ?? document);
    for (const draft of drafts) {
      if (!merged.some((document) => document.pageId === draft.pageId)) merged.push(draft.document);
    }

    const pointer = await getActivePointer();
    const result = await publishContent({ documents: merged, expectedVersion: pointer.siteVersion, actor });
    await clearPublishedDrafts(drafts.map((draft) => draft.pageId));
    setSuccess(ctx.cookies, `Published content version ${result.siteVersion}.`);
  } catch (error) {
    setError(ctx.cookies, error instanceof Error ? error.message : 'Publication failed.');
  }

  return redirect(CONTENT_PUBLISH_REDIRECT);
}

/**
 * Moves the active pointer to a previously published immutable version. Every
 * object the target manifest references is verified before the pointer moves.
 */
async function rollbackObjectStoreAction(ctx: PageContext): Promise<Response> {
  if (!ctx.adminAuth.isAdmin) {
    setError(ctx.cookies, 'Only administrators can roll back content.');
    return redirect(CONTENT_PUBLISH_REDIRECT);
  }

  const targetSiteVersion = getString(ctx.form, 'site_version');
  if (!targetSiteVersion) {
    setError(ctx.cookies, 'Choose a published version to roll back to.');
    return redirect(CONTENT_PUBLISH_REDIRECT);
  }

  const actor = {
    id: ctx.adminAuth.user?.id ?? null,
    name: ctx.adminAuth.user?.username ?? 'admin',
    isAdmin: true,
  };

  try {
    const pointer = await getActivePointer();
    const result = await rollbackContent({ targetSiteVersion, expectedVersion: pointer.siteVersion, actor });
    setSuccess(ctx.cookies, `Rolled back to content version ${result.siteVersion}.`);
  } catch (error) {
    setError(ctx.cookies, error instanceof Error ? error.message : 'Rollback failed.');
  }

  return redirect(CONTENT_PUBLISH_REDIRECT);
}

export async function contentAdmin(ctx: PageContext) {
  const denied = requireEditor(ctx);
  if (denied) return denied;

  if (ctx.request.method === 'POST') {
    const action = getString(ctx.form, 'action');
    if (action === 'publish_changes') return publishChangesAction(ctx);
    if (action === 'publish_object_store') return publishObjectStoreAction(ctx);
    if (action === 'save_content_draft') return saveContentDraftAction(ctx);
    if (action === 'discard_content_draft') return discardContentDraftAction(ctx);
    if (action === 'rollback_object_store') return rollbackObjectStoreAction(ctx);

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
  if (tab === 'publish' && !ctx.adminAuth.isAdmin) {
    return redirect('/admin/content?tab=brand');
  }

  const content = await loadContentAdmin(tab, { origin: ctx.url.origin });
  return { props: content };
}
