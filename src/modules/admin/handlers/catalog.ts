import { requireAdmin } from '../../../core/auth';
import { getInt, getString, redirect } from '../../../core/http';
import type { PageContext } from '../../../core/types';
import {
  addGalleryCategory,
  addGalleryItem,
  addGuestPricing,
  addHomeFeature,
  addMenuItem,
  addMenuSection,
  addPackageOption,
  deleteCatering,
  deleteGalleryCategory,
  deleteGalleryItem,
  deleteGuestPricing,
  deleteHall,
  deleteHomeFeature,
  deleteMenuItem,
  deleteMenuSection,
  deletePackageOption,
  deleteRoom,
  listCateringAdmin,
  listGalleryAdmin,
  listHallsAdmin,
  listRoomsAdmin,
  loadCateringAdmin,
  loadContentAdmin,
  loadHallAdmin,
  loadRoomAdmin,
  saveCatering,
  saveContactInfo,
  saveHall,
  saveHomepage,
  savePageSettings,
  saveRoom,
  toggleCatering,
  toggleCateringHome,
  toggleGalleryCategory,
  toggleGalleryItem,
  toggleHall,
  toggleMenuItem,
  toggleRoom,
} from '../service';
import { runFormAction } from './shared';

/* ---------------- Halls ---------------- */

export function hallsList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return { props: { halls: listHallsAdmin() } };
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

/* ---------------- Rooms ---------------- */

export function roomsList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return { props: { rooms: listRoomsAdmin() } };
}

export async function roomForm(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const rawId = ctx.params.id;
  const id = rawId && rawId !== 'new' ? Number(rawId) : undefined;

  if (ctx.request.method === 'POST') {
    const { setError } = await import('../../../core/flash');
    try {
      const savedId = await saveRoom(ctx.form, id);
      return redirect(`/admin/rooms/${savedId}`);
    } catch (error) {
      setError(ctx.cookies, error instanceof Error ? error.message : 'Could not save the room.');
      return redirect(id ? `/admin/rooms/${id}` : '/admin/rooms/new');
    }
  }

  const data = id ? loadRoomAdmin(id) : null;
  if (id && !data) return { props: { notFound: true }, status: 404 };
  return { props: { room: data?.room ?? null, features: data?.features ?? [], id: id ?? null } };
}

export function roomToggle(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return runFormAction(ctx, { toggle: () => toggleRoom(Number(ctx.params.id)) }, { redirectTo: '/admin/rooms' });
}

export function roomDelete(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return runFormAction(ctx, { delete: () => deleteRoom(Number(ctx.params.id)) }, { redirectTo: '/admin/rooms' });
}

/* ---------------- Catering ---------------- */

export function cateringList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return { props: { packages: listCateringAdmin() } };
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
        delete_section: () => deleteMenuSection(getInt(ctx.form, 'section_id')),
        add_item: () => addMenuItem(getInt(ctx.form, 'section_id'), ctx.form),
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
        toggle_category: () => toggleGalleryCategory(getInt(ctx.form, 'category_id')),
        add_item: () => addGalleryItem(ctx.form),
        delete_item: () => deleteGalleryItem(getInt(ctx.form, 'item_id')),
        toggle_item: () => toggleGalleryItem(getInt(ctx.form, 'item_id')),
      },
      { redirectTo: '/admin/gallery' },
    );
  }

  return { props: listGalleryAdmin() };
}

/* ---------------- Content ---------------- */

export function contentAdmin(ctx: PageContext) {
  const denied = requireAdmin(ctx);
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
      },
      { redirectTo: '/admin/content' },
    );
  }

  return { props: loadContentAdmin() };
}
