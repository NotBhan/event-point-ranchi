import { all, one, run } from '../../core/db';
import { getBoolean, getInt, getString, parseMoneyToPaise, uniqueSlug } from '../../core/http';
import { getStorageUsage, saveUploadedImage, UploadError } from '../../core/uploads';

export { UploadError };

/* ============================ Dashboard ============================ */

export function loadDashboard() {
  const counts =
    one<{
      bookings: number;
      pending: number;
      confirmed: number;
      revenue: number;
      halls: number;
      rooms: number;
      packages: number;
      customers: number;
      inquiries: number;
    }>(
      `SELECT
      (SELECT COUNT(*) FROM bookings) AS bookings,
      (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') AS confirmed,
      (SELECT COALESCE(SUM(total_amount), 0) FROM bookings WHERE status IN ('pending','confirmed')) AS revenue,
      (SELECT COUNT(*) FROM halls WHERE is_active = 1) AS halls,
      (SELECT COUNT(*) FROM rooms WHERE is_active = 1) AS rooms,
      (SELECT COUNT(*) FROM catering_packages WHERE is_active = 1) AS packages,
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COUNT(*) FROM contact_inquiries WHERE status = 'new') AS inquiries`,
    ) ?? {
      bookings: 0,
      pending: 0,
      confirmed: 0,
      revenue: 0,
      halls: 0,
      rooms: 0,
      packages: 0,
      customers: 0,
      inquiries: 0,
    };

  const recentBookings = all<{
    id: number;
    customer: string;
    event_date: string | null;
    event_type: string;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    `SELECT b.id, c.name AS customer, b.event_date, b.event_type, b.total_amount, b.status, b.created_at
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     ORDER BY b.id DESC LIMIT 8`,
  );

  const upcoming = all<{
    id: number;
    customer: string;
    event_date: string;
    event_type: string;
    total_guest: number;
    status: string;
  }>(
    `SELECT b.id, c.name AS customer, b.event_date, b.event_type, b.total_guest, b.status
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     WHERE b.event_date >= date('now') AND b.status IN ('pending','confirmed')
     ORDER BY b.event_date ASC LIMIT 6`,
  );

  const topHalls = all<{ name: string; bookings: number; revenue: number }>(
    `SELECT h.name,
            COUNT(b.id) AS bookings,
            COALESCE(SUM(b.total_amount), 0) AS revenue
     FROM halls h
     LEFT JOIN booking_halls bh ON bh.hall_id = h.id
     LEFT JOIN bookings b ON b.id = bh.booking_id AND b.status IN ('pending','confirmed')
     GROUP BY h.id ORDER BY revenue DESC LIMIT 5`,
  );

  return { counts, recentBookings, upcoming, topHalls };
}

/* ============================ Bookings ============================ */

export function listBookings(filters: { status?: string; query?: string } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    clauses.push('b.status = ?');
    params.push(filters.status);
  }
  if (filters.query) {
    clauses.push('(c.name LIKE ? OR c.phone LIKE ? OR CAST(b.id AS TEXT) LIKE ? OR b.event_type LIKE ?)');
    const like = `%${filters.query}%`;
    params.push(like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<{
    id: number;
    customer: string;
    phone: string;
    event_date: string | null;
    event_type: string;
    total_guest: number;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    `SELECT b.id, c.name AS customer, c.phone AS phone, b.event_date, b.event_type,
            b.total_guest, b.total_amount, b.status, b.created_at
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     ${where}
     ORDER BY b.id DESC LIMIT 200`,
    params,
  );
}

export function updateBookingStatus(id: number, status: string): void {
  if (!['draft', 'pending', 'confirmed', 'cancelled'].includes(status)) return;
  run('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);
}

export function deleteBooking(id: number): void {
  run('DELETE FROM bookings WHERE id = ?', [id]);
}

/* ============================ Halls ============================ */

export function listHallsAdmin() {
  return all<{
    id: number;
    name: string;
    slug: string;
    image: string | null;
    price_paise: number;
    capacity: number;
    location: string;
    is_active: number;
    is_featured: number;
    booking_count: number;
  }>(
    `SELECT h.id, h.name, h.slug, h.image, h.price_paise, h.capacity, h.location, h.is_active, h.is_featured,
            (SELECT COUNT(*) FROM booking_halls bh WHERE bh.hall_id = h.id) AS booking_count
     FROM halls h ORDER BY h.is_active DESC, h.id`,
  );
}

export function loadHallAdmin(id: number) {
  return one<Record<string, unknown>>('SELECT * FROM halls WHERE id = ?', [id]);
}

export async function saveHall(form: FormData | null, id?: number): Promise<number> {
  const name = getString(form, 'name');
  if (!name) throw new Error('Hall name is required.');

  const slugInput = getString(form, 'slug') || name;
  const existingId = id ?? 0;
  const slug = uniqueSlug(slugInput, (candidate) => {
    const clash = one<{ id: number }>('SELECT id FROM halls WHERE slug = ? AND id != ?', [candidate, existingId]);
    return Boolean(clash);
  });

  const uploadedImage = await saveUploadedImage(form, 'image', 'halls');
  const uploadedBanner = await saveUploadedImage(form, 'banner_image', 'halls');

  const values = {
    name,
    slug,
    description: getString(form, 'description'),
    image: (uploadedImage ?? getString(form, 'image_path')) || null,
    banner_image: (uploadedBanner ?? getString(form, 'banner_path')) || null,
    price_paise: parseMoneyToPaise(getString(form, 'price')),
    capacity: getInt(form, 'capacity', 0),
    location: getString(form, 'location'),
    parking_capacity: getInt(form, 'parking_capacity', 0),
    is_ac: getBoolean(form, 'is_ac') ? 1 : 0,
    is_wifi: getBoolean(form, 'is_wifi') ? 1 : 0,
    is_featured: getBoolean(form, 'is_featured') ? 1 : 0,
    show_badge: getBoolean(form, 'show_badge') ? 1 : 0,
    is_active: getBoolean(form, 'is_active') ? 1 : 0,
  };

  const params = [
    values.name,
    values.slug,
    values.description,
    values.image,
    values.banner_image,
    values.price_paise,
    values.capacity,
    values.location,
    values.parking_capacity,
    values.is_ac,
    values.is_wifi,
    values.is_featured,
    values.show_badge,
    values.is_active,
  ];

  if (id) {
    run(
      `UPDATE halls SET name = ?, slug = ?, description = ?, image = ?, banner_image = ?, price_paise = ?,
       capacity = ?, location = ?, parking_capacity = ?, is_ac = ?, is_wifi = ?, is_featured = ?, show_badge = ?,
       is_active = ?, updated_at = datetime('now') WHERE id = ?`,
      [...params, id],
    );
    return id;
  }

  return run(
    `INSERT INTO halls (name, slug, description, image, banner_image, price_paise, capacity, location,
       parking_capacity, is_ac, is_wifi, is_featured, show_badge, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params,
  ).lastId;
}

export function deleteHall(id: number): void {
  run('DELETE FROM halls WHERE id = ?', [id]);
}

export function toggleHall(id: number): void {
  run('UPDATE halls SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
}

/* ============================ Rooms ============================ */

export function listRoomsAdmin() {
  return all<{
    id: number;
    name: string;
    image: string | null;
    price_paise: number;
    capacity: number;
    total_rooms: number;
    is_active: number;
  }>(
    `SELECT r.id, r.name, r.image, r.price_paise, r.capacity, r.total_rooms, r.is_active,
            (SELECT COUNT(*) FROM room_features rf WHERE rf.room_id = r.id) AS feature_count
     FROM rooms r ORDER BY r.is_active DESC, r.id`,
  );
}

export function loadRoomAdmin(id: number) {
  const room = one<Record<string, unknown>>('SELECT * FROM rooms WHERE id = ?', [id]);
  if (!room) return null;
  const features = all<{ name: string }>('SELECT name FROM room_features WHERE room_id = ? ORDER BY id', [id]);
  return { room, features: features.map((feature) => feature.name) };
}

export async function saveRoom(form: FormData | null, id?: number): Promise<number> {
  const name = getString(form, 'name');
  if (!name) throw new Error('Room name is required.');

  const uploaded = await saveUploadedImage(form, 'image', 'rooms');
  const featureNames = getString(form, 'features')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const values = [
    name,
    parseMoneyToPaise(getString(form, 'price')),
    getInt(form, 'capacity', 1),
    getInt(form, 'total_rooms', 1),
    (uploaded ?? getString(form, 'image_path')) || null,
    getString(form, 'description'),
    getBoolean(form, 'is_active') ? 1 : 0,
  ];

  const roomId = id
    ? (run(
        `UPDATE rooms SET name = ?, price_paise = ?, capacity = ?, total_rooms = ?, image = ?, description = ?,
         is_active = ?, updated_at = datetime('now') WHERE id = ?`,
        [...values, id],
      ),
      id)
    : run(
        `INSERT INTO rooms (name, price_paise, capacity, total_rooms, image, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values,
      ).lastId;

  run('DELETE FROM room_features WHERE room_id = ?', [roomId]);
  for (const feature of featureNames) {
    run('INSERT INTO room_features (room_id, name) VALUES (?, ?)', [roomId, feature]);
  }

  return roomId;
}

export function deleteRoom(id: number): void {
  run('DELETE FROM rooms WHERE id = ?', [id]);
}

export function toggleRoom(id: number): void {
  run('UPDATE rooms SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
}

/* ============================ Catering ============================ */

export function listCateringAdmin() {
  return all<{
    id: number;
    name: string;
    slug: string;
    image: string | null;
    price_paise: number;
    badge: string;
    is_active: number;
    show_on_home: number;
    section_count: number;
    item_count: number;
  }>(
    `SELECT cp.id, cp.name, cp.slug, cp.image, cp.price_paise, cp.badge, cp.is_active, cp.show_on_home,
            (SELECT COUNT(*) FROM menu_sections ms WHERE ms.package_id = cp.id) AS section_count,
            (SELECT COUNT(*) FROM menu_items mi
              JOIN menu_categories mc ON mc.id = mi.category_id
              JOIN menu_sections ms ON ms.id = mc.section_id
              WHERE ms.package_id = cp.id) AS item_count
     FROM catering_packages cp ORDER BY cp.is_active DESC, cp.id`,
  );
}

export function loadCateringAdmin(id: number) {
  const pkg = one<Record<string, unknown>>('SELECT * FROM catering_packages WHERE id = ?', [id]);
  if (!pkg) return null;

  const features = all<{ id: number; name: string }>(
    'SELECT id, name FROM catering_features WHERE package_id = ? ORDER BY id',
    [id],
  );
  const bannerFeatures = all<{ id: number; name: string }>(
    'SELECT id, name FROM banner_features WHERE package_id = ? ORDER BY id',
    [id],
  );
  const pricing = all<{ id: number; guest_count: number; price_per_plate_paise: number }>(
    'SELECT id, guest_count, price_per_plate_paise FROM guest_pricing WHERE package_id = ? ORDER BY sort, guest_count',
    [id],
  );
  const sections = all<{ id: number; title: string; max_selection: number }>(
    'SELECT id, title, max_selection FROM menu_sections WHERE package_id = ? ORDER BY sort, id',
    [id],
  );
  const items = all<{ id: number; section_id: number; name: string; is_available: number }>(
    `SELECT mi.id, mc.section_id AS section_id, mi.name, mi.is_available
     FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
     JOIN menu_sections ms ON ms.id = mc.section_id
     WHERE ms.package_id = ? ORDER BY mi.id`,
    [id],
  );

  return {
    package: pkg,
    features,
    bannerFeatures,
    pricing,
    sections: sections.map((section) => ({
      ...section,
      items: items.filter((item) => item.section_id === section.id),
    })),
  };
}

export async function saveCatering(form: FormData | null, id?: number): Promise<number> {
  const name = getString(form, 'name');
  if (!name) throw new Error('Package name is required.');

  const existingId = id ?? 0;
  const slug = uniqueSlug(getString(form, 'slug') || name, (candidate) => {
    const clash = one<{ id: number }>(
      'SELECT id FROM catering_packages WHERE slug = ? AND id != ?',
      [candidate, existingId],
    );
    return Boolean(clash);
  });

  const uploaded = await saveUploadedImage(form, 'image', 'catering');
  const values = [
    name,
    slug,
    (uploaded ?? getString(form, 'image_path')) || null,
    parseMoneyToPaise(getString(form, 'price')),
    getString(form, 'description'),
    getString(form, 'badge'),
    getBoolean(form, 'show_on_home') ? 1 : 0,
    getBoolean(form, 'is_active') ? 1 : 0,
  ];

  if (id) {
    run(
      `UPDATE catering_packages SET name = ?, slug = ?, image = ?, price_paise = ?, description = ?, badge = ?,
       show_on_home = ?, is_active = ? WHERE id = ?`,
      [...values, id],
    );
    return id;
  }

  const packageId = run(
    `INSERT INTO catering_packages (name, slug, image, price_paise, description, badge, show_on_home, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  ).lastId;

  const sectionId = run(
    `INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort)
     VALUES (?, 'Starters & Appetizers', 1, 0, 3, 1)`,
    [packageId],
  ).lastId;
  run(`INSERT INTO menu_categories (section_id, title, sort) VALUES (?, 'Signature Bites', 1)`, [sectionId]);

  return packageId;
}

export function deleteCatering(id: number): void {
  run('DELETE FROM catering_packages WHERE id = ?', [id]);
}

export function toggleCatering(id: number): void {
  run('UPDATE catering_packages SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
}

export function toggleCateringHome(id: number): void {
  run('UPDATE catering_packages SET show_on_home = CASE show_on_home WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
}

export function addMenuSection(packageId: number, form: FormData | null): void {
  const title = getString(form, 'title');
  if (!title) return;
  const sectionId = run(
    `INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort)
     VALUES (?, ?, 1, 0, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM menu_sections WHERE package_id = ?))`,
    [packageId, title, getInt(form, 'max_selection', 3), packageId],
  ).lastId;
  run(`INSERT INTO menu_categories (section_id, title, sort) VALUES (?, ?, 1)`, [sectionId, `${title} selection`]);
}

export function updateMenuSection(sectionId: number, form: FormData | null): void {
  const title = getString(form, 'title');
  const maxSelection = getInt(form, 'max_selection', 3);
  if (!title) return;
  run('UPDATE menu_sections SET title = ?, max_selection = ? WHERE id = ?', [title, maxSelection, sectionId]);
}

export function deleteMenuSection(sectionId: number): void {
  run('DELETE FROM menu_sections WHERE id = ?', [sectionId]);
}

export function addMenuItem(sectionId: number, form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  const category = one<{ id: number }>(
    'SELECT id FROM menu_categories WHERE section_id = ? ORDER BY sort, id LIMIT 1',
    [sectionId],
  );
  const categoryId =
    category?.id ??
    run(`INSERT INTO menu_categories (section_id, title, sort) VALUES (?, 'Selection', 1)`, [sectionId]).lastId;
  run('INSERT INTO menu_items (category_id, name, is_available) VALUES (?, ?, 1)', [categoryId, name]);
}

export function updateMenuItem(itemId: number, form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  run('UPDATE menu_items SET name = ? WHERE id = ?', [name, itemId]);
}

export function deleteMenuItem(itemId: number): void {
  run('DELETE FROM menu_items WHERE id = ?', [itemId]);
}

export function toggleMenuItem(itemId: number): void {
  run('UPDATE menu_items SET is_available = CASE is_available WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [itemId]);
}

export function addGuestPricing(packageId: number, form: FormData | null): void {
  const guestCount = getInt(form, 'guest_count', 0);
  const price = parseMoneyToPaise(getString(form, 'price_per_plate'));
  if (guestCount <= 0 || price <= 0) return;
  run(
    `INSERT INTO guest_pricing (package_id, guest_count, price_per_plate_paise, sort)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM guest_pricing WHERE package_id = ?))`,
    [packageId, guestCount, price, packageId],
  );
}

export function deleteGuestPricing(id: number): void {
  run('DELETE FROM guest_pricing WHERE id = ?', [id]);
}

export function addPackageOption(table: 'catering_features' | 'banner_features', packageId: number, form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  run(`INSERT INTO ${table} (package_id, name) VALUES (?, ?)`, [packageId, name]);
}

export function deletePackageOption(table: 'catering_features' | 'banner_features', id: number): void {
  run(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

/* ============================ Gallery ============================ */

export function listGalleryAdmin(options?: { page?: number; perPage?: number; categoryId?: number }) {
  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.max(1, Math.min(100, options?.perPage ?? 18));
  const categoryId = options?.categoryId ?? 0;

  const categories = all<{ id: number; name: string; is_active: number; item_count: number }>(
    `SELECT gc.id, gc.name, gc.is_active,
            (SELECT COUNT(*) FROM gallery_items gi WHERE gi.category_id = gc.id) AS item_count
     FROM gallery_categories gc ORDER BY gc.sort, gc.name`,
  );

  const whereClause = categoryId > 0 ? 'WHERE category_id = ?' : '';
  const queryParams = categoryId > 0 ? [categoryId] : [];

  const totalRow = one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM gallery_items ${whereClause}`,
    queryParams,
  );
  const totalCount = Number(totalRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * perPage;

  const items = all<{ id: number; title: string; image: string; category_id: number; is_active: number; created_at: string }>(
    `SELECT id, title, image, category_id, is_active, created_at FROM gallery_items ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...queryParams, perPage, offset],
  );

  const storageUsage = getStorageUsage();

  return {
    categories,
    items,
    pagination: {
      page: currentPage,
      perPage,
      totalCount,
      totalPages,
      selectedCategory: categoryId,
      startItem: totalCount === 0 ? 0 : offset + 1,
      endItem: Math.min(offset + items.length, totalCount),
    },
    storageUsage,
  };
}

export function addGalleryCategory(form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  const slug = uniqueSlug(name, (candidate) =>
    Boolean(one<{ id: number }>('SELECT id FROM gallery_categories WHERE slug = ?', [candidate])),
  );
  run('INSERT INTO gallery_categories (name, slug, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM gallery_categories))', [
    name,
    slug,
  ]);
}

export function deleteGalleryCategory(id: number): void {
  run('DELETE FROM gallery_categories WHERE id = ?', [id]);
}

export function toggleGalleryCategory(id: number): boolean {
  run('UPDATE gallery_categories SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
  return Boolean(one<{ is_active: number }>('SELECT is_active FROM gallery_categories WHERE id = ?', [id])?.is_active);
}

export async function addGalleryItem(form: FormData | null): Promise<void> {
  const categoryId = getInt(form, 'category_id', 0);
  if (!categoryId) throw new Error('Choose a gallery category.');
  const title = getString(form, 'title');
  if (!title) throw new Error('Add a caption for the image.');
  const uploaded = await saveUploadedImage(form, 'image', 'gallery');
  const image = uploaded ?? getString(form, 'image_path');
  if (!image) throw new Error('Upload an image or paste an image path.');
  run('INSERT INTO gallery_items (category_id, title, image, is_active) VALUES (?, ?, ?, 1)', [categoryId, title, image]);
}

export function saveGalleryItemTitle(id: number, form: FormData | null): string {
  const title = getString(form, 'title');
  if (!title) throw new Error('Add a caption for the image.');
  run('UPDATE gallery_items SET title = ? WHERE id = ?', [title, id]);
  return title;
}

export function saveGalleryItemCategory(id: number, form: FormData | null): number {
  const categoryId = getInt(form, 'category_id', 0);
  if (!categoryId) throw new Error('Choose a valid category.');
  run('UPDATE gallery_items SET category_id = ? WHERE id = ?', [categoryId, id]);
  return categoryId;
}

export function deleteGalleryItem(id: number): void {
  run('DELETE FROM gallery_items WHERE id = ?', [id]);
}

export function toggleGalleryItem(id: number): boolean {
  run('UPDATE gallery_items SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
  return Boolean(one<{ is_active: number }>('SELECT is_active FROM gallery_items WHERE id = ?', [id])?.is_active);
}

/* ============================ Customers ============================ */

export function listCustomers(query?: string) {
  const like = `%${query ?? ''}%`;
  const where = query ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : '';
  const params = query ? [like, like, like] : [];
  return all<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    created_at: string;
    booking_count: number;
    total_spend: number;
  }>(
    `SELECT c.id, c.name, c.phone, c.email, c.created_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS booking_count,
            (SELECT COALESCE(SUM(b.total_amount), 0) FROM bookings b WHERE b.customer_id = c.id AND b.status IN ('pending','confirmed')) AS total_spend
     FROM customers c ${where} ORDER BY c.id DESC LIMIT 200`,
    params,
  );
}

export function loadCustomerAdmin(id: number) {
  const customer = one<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    address: string | null;
    created_at: string;
    username: string | null;
  }>(
    `SELECT c.*, u.username AS username FROM customers c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [id],
  );
  if (!customer) return null;

  const bookings = all<{
    id: number;
    event_date: string | null;
    event_type: string;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    'SELECT id, event_date, event_type, total_amount, status, created_at FROM bookings WHERE customer_id = ? ORDER BY id DESC',
    [id],
  );

  return { customer, bookings };
}

/* ============================ Inquiries ============================ */

export function listInquiries(status?: string) {
  const where = status && status !== 'all' ? 'WHERE status = ?' : '';
  const params = where ? [status] : [];
  return all<{
    id: number;
    name: string;
    phone: string;
    email: string;
    event_type: string;
    event_date: string | null;
    guest_count: number | null;
    message: string;
    status: string;
    created_at: string;
  }>(`SELECT * FROM contact_inquiries ${where} ORDER BY id DESC LIMIT 200`, params);
}

export function updateInquiryStatus(id: number, status: string): void {
  if (!['new', 'contacted', 'closed'].includes(status)) return;
  run('UPDATE contact_inquiries SET status = ? WHERE id = ?', [status, id]);
}

export function deleteInquiry(id: number): void {
  run('DELETE FROM contact_inquiries WHERE id = ?', [id]);
}

/* ============================ Content ============================ */

export function loadContentAdmin() {
  const homepage = one<{ hero_title: string; hero_description: string; hero_image: string | null }>(
    'SELECT hero_title, hero_description, hero_image FROM homepage WHERE id = 1',
  );
  const features = all<{ id: number; icon: string; title: string; description: string }>(
    'SELECT id, icon, title, description FROM homepage_features ORDER BY sort, id',
  );
  const pages = all<{ key: string; hero_title: string; hero_subtitle: string; hero_badge: string; hero_image: string | null }>(
    'SELECT key, hero_title, hero_subtitle, hero_badge, hero_image FROM page_settings ORDER BY key',
  );
  const contact = one<{ address: string; phone: string; email: string }>(
    'SELECT address, phone, email FROM contact_info WHERE id = 1',
  );
  return { homepage, features, pages, contact };
}

export async function saveHomepage(form: FormData | null): Promise<void> {
  const uploaded = await saveUploadedImage(form, 'hero_image', 'content');
  const image = (uploaded ?? getString(form, 'hero_image_path')) || null;
  run('UPDATE homepage SET hero_title = ?, hero_description = ?, hero_image = ? WHERE id = 1', [
    getString(form, 'hero_title'),
    getString(form, 'hero_description'),
    image,
  ]);
}

export function addHomeFeature(form: FormData | null): void {
  const title = getString(form, 'title');
  if (!title) return;
  run(
    `INSERT INTO homepage_features (icon, title, description, sort)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM homepage_features))`,
    [getString(form, 'icon') || 'sparkles', title, getString(form, 'description')],
  );
}

export function deleteHomeFeature(id: number): void {
  run('DELETE FROM homepage_features WHERE id = ?', [id]);
}

export async function savePageSettings(form: FormData | null): Promise<void> {
  const uploaded = await saveUploadedImage(form, 'hero_image', 'content');
  const image = (uploaded ?? getString(form, 'hero_image_path')) || null;

  const existing = one<{ hero_image: string | null }>('SELECT hero_image FROM page_settings WHERE key = ?', [
    getString(form, 'key'),
  ]);

  run(
    `UPDATE page_settings SET hero_title = ?, hero_subtitle = ?, hero_badge = ?, hero_image = ? WHERE key = ?`,
    [
      getString(form, 'hero_title'),
      getString(form, 'hero_subtitle'),
      getString(form, 'hero_badge'),
      image ?? existing?.hero_image ?? null,
      getString(form, 'key'),
    ],
  );
}

export function saveContactInfo(form: FormData | null): void {
  run('UPDATE contact_info SET address = ?, phone = ?, email = ? WHERE id = 1', [
    getString(form, 'address'),
    getString(form, 'phone'),
    getString(form, 'email'),
  ]);
}

/* ============================ Event enquiries ============================ */

export interface EventEnquiryRow {
  id: number;
  reference_code: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  event_type: string;
  event_date: string;
  end_date: string | null;
  event_time: string | null;
  venue_location: string;
  guest_count: number;
  budget_range: string;
  requires_rooms: number;
  room_count: number;
  accommodation_notes: string;
  decoration_notes: string;
  preferred_contact: string;
  status: string;
  created_at: string;
}

export interface EnquiryLineItemRow {
  id: number;
  enquiry_id: number;
  item_type: string;
  catalogue_item_id: number | null;
  item_name_snapshot: string;
  quantity: number;
  standard_dimensions_snapshot: string;
  requested_length_ft: number | null;
  requested_width_ft: number | null;
  requested_height_ft: number | null;
  specifications: string;
  notes: string;
}

export function listEventEnquiries(filters: { status?: string; query?: string } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  if (filters.query) {
    const like = `%${filters.query}%`;
    clauses.push(
      '(reference_code LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR event_type LIKE ? OR venue_location LIKE ?)',
    );
    params.push(like, like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return all<EventEnquiryRow>(
    `SELECT id, reference_code, customer_name, customer_phone, customer_email, event_type,
            event_date, end_date, event_time, venue_location, guest_count, budget_range,
            requires_rooms, room_count, accommodation_notes, decoration_notes, preferred_contact,
            status, created_at
     FROM event_enquiries
     ${where}
     ORDER BY id DESC LIMIT 200`,
    params,
  );
}

export function loadEventEnquiry(id: number): { enquiry: EventEnquiryRow; lines: EnquiryLineItemRow[] } | null {
  const enquiry = one<EventEnquiryRow>('SELECT * FROM event_enquiries WHERE id = ?', [id]);
  if (!enquiry) return null;

  const lines = all<EnquiryLineItemRow>(
    'SELECT * FROM enquiry_line_items WHERE enquiry_id = ? ORDER BY id',
    [id],
  );

  return { enquiry, lines };
}

export function updateEventEnquiryStatus(id: number, status: string): void {
  if (!['new', 'reviewing', 'quoted', 'confirmed', 'archived'].includes(status)) {
    throw new Error('Invalid enquiry status.');
  }
  run('UPDATE event_enquiries SET status = ? WHERE id = ?', [status, id]);
}

