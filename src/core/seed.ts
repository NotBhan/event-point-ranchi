import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './password';

function isoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

export function seedDatabase(db: DatabaseSync): void {
  const insert = (sql: string, params: unknown[] = []): number =>
    Number(
      db
        .prepare(sql)
        .run(...(params.map((v) => (v === undefined ? null : v)) as never[]))
        .lastInsertRowid,
    );

  const adminPassword =
    process.env.ADMIN_PASSWORD ||
    (typeof import.meta !== 'undefined' && import.meta.env?.ADMIN_PASSWORD) ||
    'admin';

  db.exec('BEGIN');
  try {
    insert(
      `INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, ?)`,
      ['admin', 'admin@eventpointranchi.com', hashPassword(adminPassword), 'Root', 'developer'],
    );
    insert(
      `INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, ?)`,
      ['superadmin', 'superadmin@eventpointranchi.com', hashPassword('Super@Royal2026!'), 'Vikramaditya', 'superadmin'],
    );
    insert(
      `INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, ?)`,
      ['event_manager', 'manager@eventpointranchi.com', hashPassword('Manager@Royal2026!'), 'Rajesh', 'admin'],
    );
    const customerSeed = [
      ['rohit_sharma', 'Rohit Sharma', 'rohit.sharma@example.com', '9876543210', 'Flat 402, Sea Green Heights, Worli, Mumbai'],
      ['priya_patel', 'Priya Patel', 'priya.patel@example.com', '9812345678', 'Villa 12, Palm Meadows, Whitefield, Bangalore'],
      ['vikram_mehta', 'Vikram Mehta', 'vikram.mehta@example.com', '9823456789', 'A-15, Civil Lines, Jaipur, Rajasthan'],
      ['ananya_singh', 'Ananya Singh', 'ananya.singh@example.com', '9834567890', 'Tower 3, Sector 62, Golf Course Road, Gurgaon'],
      ['kavita_reddy', 'Kavita Reddy', 'kavita.reddy@example.com', '9845678901', 'Road No. 36, Jubilee Hills, Hyderabad'],
      ['arjun_kapoor', 'Arjun Kapoor', 'arjun.kapoor@example.com', '9856789012', 'Bungalow 7, Queens Park, Alipore, Kolkata'],
    ] as const;

    const customerIds: number[] = [];
    for (const [username, name, email, phone, address] of customerSeed) {
      const userId = insert(
        `INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, 'customer')`,
        [username, email, hashPassword('Client@2026!'), name.split(' ')[0]],
      );
      customerIds.push(
        insert(
          `INSERT INTO customers (user_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)`,
          [userId, name, phone, email, address],
        ),
      );
    }

    const hallSeed = [
      {
        name: 'Royal Kohinoor Grand Ballroom',
        slug: 'royal-kohinoor-ballroom',
        description:
          'Our flagship grand ballroom with Bohemian crystal chandeliers, soaring ceilings, acoustic insulation and an expansive stage for royal weddings and international summits.',
        image: '/images/archive/fernando-alvarez-rodriguez-M7GddPqJowg-unsplash.jpg',
        banner: '/images/archive/fernando-alvarez-rodriguez-M7GddPqJowg-unsplash.jpg',
        price: 25_000_000,
        capacity: 800,
        location: 'North Wing, Level 1',
        parking: 250,
        featured: 1,
        badge: 1,
        gallery: [
          '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg',
          '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg',
        ],
        features: [
          ['snowflake', 'Central Air Conditioning', 'High-capacity multi-zone climate control'],
          ['wifi', 'High-Speed Wi-Fi 6', 'Dedicated gigabit connectivity throughout'],
          ['parking', 'Valet Parking Available', '250+ reserved underground vehicle bays'],
          ['users', '800 Guest Capacity', 'Spacious banquet seating and aisle layout'],
          ['music', 'Concert-Grade Acoustics', 'JBL surround line-array audio setup'],
          ['sparkles', 'Intelligent Stage Lighting', 'Motorized RGB beam and wash luminaires'],
        ],
      },
      {
        name: 'Imperial Crystal Palace Hall',
        slug: 'imperial-crystal-hall',
        description:
          'Contemporary glass architecture with double-height panoramic garden views, dynamic LED wash lighting and dedicated VIP hospitality lounges.',
        image: '/images/archive/point3d-commercial-imaging-ltd-oxeCZrodz78-unsplash.jpg',
        banner: '/images/archive/point3d-commercial-imaging-ltd-oxeCZrodz78-unsplash.jpg',
        price: 18_000_000,
        capacity: 500,
        location: 'East Wing, Ground Floor',
        parking: 180,
        featured: 1,
        badge: 1,
        gallery: [
          '/images/archive/linus-mimietz-p3UWyaujtQo-unsplash.jpg',
          '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg',
        ],
        features: [
          ['snowflake', 'Climate Controlled', 'Independent airflow regulation'],
          ['sparkles', 'Panoramic Glass Facade', 'Natural lighting and sunset garden views'],
          ['parking', 'Dedicated VIP Parking', '180 secure parking slots'],
          ['utensils', 'Integrated Cocktail Lounge', 'Built-in marble beverage counter'],
        ],
      },
      {
        name: 'Heritage Regal Pavilion',
        slug: 'heritage-regal-pavilion',
        description:
          'Traditional Rajasthani stone jharokhas, handcrafted wooden motifs and an intimate acoustic ambiance for traditional ceremonies and engagements.',
        image: '/images/archive/vojtech-bruzek-Yrxr3bsPdS0-unsplash.jpg',
        banner: '/images/archive/vojtech-bruzek-Yrxr3bsPdS0-unsplash.jpg',
        price: 12_000_000,
        capacity: 350,
        location: 'Heritage Courtyard',
        parking: 120,
        featured: 0,
        badge: 0,
        gallery: ['/images/archive/christian-lambert-vmIWr0NnpCQ-unsplash.jpg'],
        features: [
          ['building', 'Artisanal Heritage Arches', 'Hand-carved sandstone pillars'],
          ['snowflake', 'Concealed AC Ducts', 'Silent split-duct cooling system'],
          ['sparkles', 'Open Courtyard Access', 'Direct flow to the royal fountain garden'],
        ],
      },
      {
        name: 'Emerald Garden Lawn & Banquet',
        slug: 'emerald-garden-lawn',
        description:
          'Expansive green lawn with illuminated palm avenues, waterfall backdrops and open-air luxury cabanas for sangeet and reception nights.',
        image: '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg',
        banner: '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg',
        price: 15_000_000,
        capacity: 650,
        location: 'Outdoor South Gardens',
        parking: 200,
        featured: 1,
        badge: 1,
        gallery: ['/images/archive/gerson-repreza-CepDpEiALqM-unsplash.jpg'],
        features: [
          ['sparkles', 'Lush Carpet Lawn', '15,000 sq. ft. manicured natural turf'],
          ['star', 'Fairytale Fairy Lighting', 'Illuminated palm tree canopy'],
          ['shield', 'All-Weather Pergolas', 'Waterproof semi-covered cabanas'],
        ],
      },
    ];

    const hallIds: number[] = [];
    const furnitureByHall: number[][] = [];
    const stagesByHall: number[][] = [];
    const servicesByHall: number[][] = [];

    for (const hall of hallSeed) {
      const hallId = insert(
        `INSERT INTO halls (name, slug, description, image, banner_image, price_paise, capacity, location, parking_capacity, is_featured, show_badge)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          hall.name,
          hall.slug,
          hall.description,
          hall.image,
          hall.banner,
          hall.price,
          hall.capacity,
          hall.location,
          hall.parking,
          hall.featured,
          hall.badge,
        ],
      );
      hallIds.push(hallId);

      hall.features.forEach(([icon, title, subtitle], index) => {
        insert(`INSERT INTO hall_features (hall_id, icon, title, subtitle, sort) VALUES (?, ?, ?, ?, ?)`, [
          hallId,
          icon,
          title,
          subtitle,
          index + 1,
        ]);
      });

      hall.gallery.forEach((image, index) => {
        insert(`INSERT INTO hall_gallery (hall_id, image, title, sort) VALUES (?, ?, ?, ?)`, [
          hallId,
          image,
          hall.name,
          index + 1,
        ]);
      });

      const furnitureCategory = insert(
        `INSERT INTO furniture_categories (hall_id, name, sort) VALUES (?, ?, 1)`,
        [hallId, 'Banquet Seating & Tables'],
      );
      const furniture = [
        ['Golden Chiavari Chairs with Velvet Cushions', 25_000, 'piece', 500],
        ['Round 10-Seater Banquet Tables with Silk Linen', 85_000, 'table', 60],
        ['Royal Maharaja Velvet Twin Sofa', 500_000, 'set', 20],
        ['Illuminated High-Top Cocktail Bar Stools', 40_000, 'piece', 100],
      ] as const;
      const furnitureIds: number[] = [];
      for (const [name, price, unit, max] of furniture) {
        furnitureIds.push(
          insert(
            `INSERT INTO furniture_items (category_id, name, icon, price_paise, unit, default_quantity, min_quantity, max_quantity)
             VALUES (?, ?, 'chair', ?, ?, 0, 0, ?)`,
            [furnitureCategory, name, price, unit, max],
          ),
        );
      }
      furnitureByHall.push(furnitureIds);

      const stageCategory = insert(
        `INSERT INTO stage_categories (hall_id, name, description, sort) VALUES (?, ?, ?, 1)`,
        [hallId, 'Grand Wedding & Gala Stages', 'Signature stage concepts styled by our in-house design team.'],
      );
      const stages = [
        ['Royal Kohinoor Floral Mandap & Stage', 'Signature', '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg', 6_500_000],
        ['Modern Crystal & LED Infinity Stage', 'Trending', '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg', 8_500_000],
        ['Traditional Marigold & Brass Heritage Stage', 'Classic', '/images/archive/christian-lambert-vmIWr0NnpCQ-unsplash.jpg', 4_500_000],
      ] as const;
      const stageIds: number[] = [];
      for (const [name, badge, image, price] of stages) {
        stageIds.push(
          insert(
            `INSERT INTO stage_designs (category_id, name, badge, image, price_paise) VALUES (?, ?, ?, ?, ?)`,
            [stageCategory, name, badge, image, price],
          ),
        );
      }
      stagesByHall.push(stageIds);

      const serviceCategory = insert(
        `INSERT INTO service_categories (hall_id, name, subtitle, sort) VALUES (?, ?, ?, 1)`,
        [hallId, 'Production & Media Services', 'Add broadcast-quality production and guest experience teams.'],
      );
      const services = [
        ['Cinematic 4K Drone & 3-Camera Live Stream', 4_500_000],
        ['Traditional Shehnai & Classical Orchestra Ensemble', 3_000_000],
        ['Intelligent Robotic Moving-Head Stage Lighting', 3_500_000],
        ['VIP Valet Parking & Concierge Fleet Team', 2_000_000],
      ] as const;
      const serviceIds: number[] = [];
      for (const [name, price] of services) {
        serviceIds.push(
          insert(`INSERT INTO services (category_id, name, price_paise) VALUES (?, ?, ?)`, [
            serviceCategory,
            name,
            price,
          ]),
        );
      }
      servicesByHall.push(serviceIds);
    }

    const roomSeed = [
      {
        name: 'Presidential Luxury Suite',
        price: 1_200_000,
        capacity: 2,
        total: 4,
        image: '/images/archive/roberto-nickson-emqnSQwQQDo-unsplash.jpg',
        description:
          'Master king suite with panoramic balcony views, jacuzzi bath, Italian furnishings and 24/7 butler service.',
        features: ['King Size Plush Bed', 'Jacuzzi & Designer Bath', 'Private Scenic Balcony', 'Central AC', 'High-Speed Wi-Fi', 'Mini Bar'],
      },
      {
        name: 'Bridal VIP Preparation Suite',
        price: 1_500_000,
        capacity: 4,
        total: 2,
        image: '/images/archive/sasha-kaunas-TAgGZWz6Qg8-unsplash.jpg',
        description:
          'Spacious styling suite with 360-degree vanity mirrors, makeup stations, steamer wardrobe and private stage access.',
        features: ['Salon Makeup Station', 'Full-Length Mirrors', 'Garment Steamer', 'Attached Luxury Washroom', 'Direct Stage Access'],
      },
      {
        name: 'Executive Deluxe Suite',
        price: 750_000,
        capacity: 2,
        total: 14,
        image: '/images/archive/sasha-kaunas-67-sOi7mVIk-unsplash.jpg',
        description:
          'Contemporary executive accommodation with plush queen bedding, ergonomic work desk, smart TV and garden views.',
        features: ['Plush Queen Bed', 'En-suite Bathroom', 'Smart LED TV', 'Work Desk', 'Complimentary Wi-Fi'],
      },
      {
        name: 'Family Celebration Suite',
        price: 900_000,
        capacity: 5,
        total: 6,
        image: '/images/archive/sasha-kaunas-xEaAoizNFV8-unsplash.jpg',
        description:
          'Dual-bedroom family suite for wedding parties, with a shared lounge and dining space.',
        features: ['Dual Bedrooms', 'Living & Dining Lounge', '2 Attached Bathrooms', 'Climate Control', 'Tea/Coffee Maker'],
      },
      {
        name: 'Standard Guest Accommodation',
        price: 450_000,
        capacity: 2,
        total: 25,
        image: '/images/archive/francesca-saraco-_dS27XGgRyQ-unsplash.jpg',
        description:
          'Comfortable, climate-controlled guest rooms for travelling event attendees with all essential amenities.',
        features: ['Twin / Queen Bedding', 'Attached Washroom', 'Air Conditioning', 'High-Speed Internet', 'Daily Housekeeping'],
      },
    ];

    const roomIds: number[] = [];
    for (const room of roomSeed) {
      const roomId = insert(
        `INSERT INTO rooms (name, price_paise, capacity, total_rooms, image, description) VALUES (?, ?, ?, ?, ?, ?)`,
        [room.name, room.price, room.capacity, room.total, room.image, room.description],
      );
      roomIds.push(roomId);
      for (const feature of room.features) {
        insert(`INSERT INTO room_features (room_id, name) VALUES (?, ?)`, [roomId, feature]);
      }
    }

    const cateringSeed = [
      {
        name: 'Royal Shahi Feast (Platinum Menu)',
        slug: 'royal-shahi-platinum',
        price: 185_000,
        image: '/images/archive/manuel-moreno-DGa0LQ0yDPc-unsplash.jpg',
        badge: 'Signature',
        description:
          'Seven-course live gourmet dining with an imported mocktail bar, artisanal kebabs and a dessert boutique.',
        features: ['7-Course Live Dining', 'Imported Mocktail Bar', 'Dessert Boutique', 'Dedicated Service Brigade'],
        banner: ['Live Counters', 'Premium Crockery'],
      },
      {
        name: 'Grand Imperial Buffet (Gold Menu)',
        slug: 'grand-imperial-gold',
        price: 145_000,
        image: '/images/archive/rhema-kallianpur-uocSnWMhnAs-unsplash.jpg',
        badge: 'Most Popular',
        description:
          'Five-course spread spanning Mughlai, Pan-Asian, Continental and traditional Indian live counters.',
        features: ['5-Course Buffet', 'Multi-Cuisine Counters', 'Welcome Drinks', 'Live Desserts'],
        banner: ['Multi-Cuisine', 'Live Grill'],
      },
      {
        name: 'Regal Celebration Spread (Silver Menu)',
        slug: 'regal-silver-spread',
        price: 115_000,
        image: '/images/archive/sara-dubler-Koei_7yYtIo-unsplash.jpg',
        badge: 'Best Value',
        description:
          'Classic banquet buffet with welcome drinks, appetizers, a multi-cuisine main course and traditional sweets.',
        features: ['Welcome Drinks', 'Veg & Non-Veg Mains', 'Traditional Sweets', 'Professional Service'],
        banner: ['Banquet Buffet', 'Traditional Sweets'],
      },
    ];

    const packageIds: number[] = [];
    for (const pkg of cateringSeed) {
      const packageId = insert(
        `INSERT INTO catering_packages (name, slug, image, price_paise, description, badge, show_on_home, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [pkg.name, pkg.slug, pkg.image, pkg.price, pkg.description, pkg.badge],
      );
      packageIds.push(packageId);

      pkg.features.forEach((name) =>
        insert(`INSERT INTO catering_features (package_id, name) VALUES (?, ?)`, [packageId, name]),
      );
      pkg.banner.forEach((name) =>
        insert(`INSERT INTO banner_features (package_id, name) VALUES (?, ?)`, [packageId, name]),
      );

      [100, 250, 500].forEach((guests, index) => {
        const tierPrice = pkg.price - index * 10_000;
        insert(
          `INSERT INTO guest_pricing (package_id, guest_count, price_per_plate_paise, sort) VALUES (?, ?, ?, ?)`,
          [packageId, guests, tierPrice, index + 1],
        );
      });

      const menuSections = [
        {
          title: 'Appetizers & Starters',
          max: 3,
          category: 'Live Kebabs & Bites',
          items: ['Paneer Tikka Angara', 'Dahi Ke Kebab', 'Tandoori Broccoli', 'Corn & Cheese Croquettes'],
        },
        {
          title: 'Royal Main Course',
          max: 4,
          category: 'Curries & Breads',
          items: ['Paneer Lababdar', 'Dal Makhani Bukhara', 'Kashmiri Dum Pulao', 'Subz Biryani', 'Butter Naan'],
        },
        {
          title: 'Dessert Boutique',
          max: 2,
          category: 'Sweet Delights',
          items: ['Shahi Tukda with Rabri', 'Kesari Jalebi Live Counter', 'Gulab Jamun'],
        },
        {
          title: 'Live Counters',
          max: 2,
          category: 'Chaat & Grill',
          items: ['Pani Puri Station', 'Tandoori Grill Counter', 'Pasta Live Counter'],
        },
      ];

      menuSections.forEach((section, sectionIndex) => {
        const sectionId = insert(
          `INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort)
           VALUES (?, ?, 1, ?, ?, ?)`,
          [packageId, section.title, section.items.length, section.max, sectionIndex + 1],
        );
        const categoryId = insert(
          `INSERT INTO menu_categories (section_id, title, sort) VALUES (?, ?, 1)`,
          [sectionId, section.category],
        );
        section.items.forEach((item) =>
          insert(`INSERT INTO menu_items (category_id, name, is_available) VALUES (?, ?, 1)`, [
            categoryId,
            item,
          ]),
        );
      });
    }

    const galleryCategories = [
      ['Mandap Designs', 'mandap-designs'],
      ['Stage Designs', 'stage-designs'],
      ['Furniture & Décor', 'furniture-decor'],
      ['Event Celebrations', 'event-celebrations'],
    ] as const;
    const galleryCategoryIds: number[] = [];
    for (const [name, slug] of galleryCategories) {
      galleryCategoryIds.push(
        insert(`INSERT INTO gallery_categories (name, slug, sort) VALUES (?, ?, ?)`, [
          name,
          slug,
          galleryCategoryIds.length + 1,
        ]),
      );
    }

    const galleryItems = [
      [0, 'Royal Rajputana Carved Mandap', '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg'],
      [0, 'Floating Floral Dome Mandap', '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg'],
      [0, 'Temple Pillar Ceremony', '/images/archive/christian-lambert-vmIWr0NnpCQ-unsplash.jpg'],
      [1, 'Modern LED Horizon Stage', '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg'],
      [1, 'Grand Mughal Backdrop', '/images/archive/gerson-repreza-CepDpEiALqM-unsplash.jpg'],
      [1, 'Minimalist Geometric Floral Stage', '/images/archive/linus-mimietz-p3UWyaujtQo-unsplash.jpg'],
      [2, 'Maharaja Lounge Setting', '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg'],
      [2, 'Royal Table Styling', '/images/archive/manuel-moreno-DGa0LQ0yDPc-unsplash.jpg'],
      [3, 'Garden Sangeet Evening', '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg'],
      [3, 'Reception Under the Stars', '/images/archive/point3d-commercial-imaging-ltd-oxeCZrodz78-unsplash.jpg'],
    ] as const;
    for (const [categoryIndex, title, image] of galleryItems) {
      insert(`INSERT INTO gallery_items (category_id, title, image) VALUES (?, ?, ?)`, [
        galleryCategoryIds[categoryIndex],
        title,
        image,
      ]);
    }

    insert(
      `INSERT INTO homepage (id, hero_title, hero_description, hero_image) VALUES (1, ?, ?, ?)`,
      [
        "Create the Wedding Setup You've Always Imagined.",
        'Royal mandaps, statement stage designs, furniture and event equipment — planned, delivered and styled by one Ranchi team. Share your vision and receive a considered quotation.',
        '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
      ],
    );

    const homeFeatures = [
      ['archway', 'Signature Mandaps', 'Carved, floral and contemporary mandap concepts built to your dimensions.'],
      ['theater', 'Stage Design Studio', 'Reception and ceremony stages styled around your palette and venue.'],
      ['chair', 'Furniture & Equipment', 'Chairs, tables, lounge seating, lighting and event essentials in one place.'],
      ['shield', 'One Planning Team', 'A single Ranchi-based coordinator from first enquiry to final setup.'],
    ] as const;
    homeFeatures.forEach(([icon, title, description], index) => {
      insert(
        `INSERT INTO homepage_features (icon, title, description, sort) VALUES (?, ?, ?, ?)`,
        [icon, title, description, index + 1],
      );
    });

    insert(`INSERT INTO contact_info (id, address, phone, email) VALUES (1, ?, ?, ?)`, [
      'Event Point, Main Road, Ranchi, Jharkhand 834001, India',
      '+91 98765 43210',
      'info@eventpointranchi.com',
    ]);

    const pages = [
      ['mandaps', 'Wedding Mandaps, Designed Around You', 'Explore traditional, floral and contemporary mandap concepts with clear standard dimensions.', 'MANDAP COLLECTION', '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg'],
      ['stages', 'Reception & Ceremony Stages', 'Statement backdrops, layered florals and lighting designed for photographs and guest sightlines.', 'STAGE DESIGNS', '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg'],
      ['equipment', 'Furniture & Event Equipment', 'Build a practical equipment list with quantities, finishes and specifications.', 'EQUIPMENT CATALOGUE', '/images/archive/manuel-moreno-DGa0LQ0yDPc-unsplash.jpg'],
      ['gallery', 'Moments At Event Point Ranchi', 'Mandap details, stage settings and celebrations styled by our Ranchi team.', 'THE COLLECTION', '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg'],
    ] as const;
    for (const [key, title, subtitle, badge, image] of pages) {
      insert(
        `INSERT INTO page_settings (key, hero_title, hero_subtitle, hero_badge, hero_image) VALUES (?, ?, ?, ?, ?)`,
        [key, title, subtitle, badge, image],
      );
    }

    const bookingSeed = [
      {
        customer: customerIds[0],
        eventType: 'Grand Wedding Ceremony',
        eventDate: isoDate(21),
        eventTime: '18:00',
        guests: 450,
        status: 'confirmed',
        hallIndex: 0,
        rooms: [
          [0, 2],
          [1, 1],
          [2, 4],
        ],
        stageIndex: 0,
        furniture: [
          [0, 250],
          [1, 25],
        ],
        serviceIndexes: [0, 2],
        packageIndex: 0,
        cateringGuests: 450,
        items: [
          ['Appetizers & Starters', 'Paneer Tikka Angara'],
          ['Appetizers & Starters', 'Dahi Ke Kebab'],
          ['Royal Main Course', 'Paneer Lababdar'],
          ['Royal Main Course', 'Dal Makhani Bukhara'],
          ['Dessert Boutique', 'Shahi Tukda with Rabri'],
        ],
      },
      {
        customer: customerIds[1],
        eventType: 'Royal Sangeet & Cocktail Night',
        eventDate: isoDate(14),
        eventTime: '19:30',
        guests: 300,
        status: 'confirmed',
        hallIndex: 1,
        rooms: [
          [2, 3],
          [4, 5],
        ],
        stageIndex: 1,
        furniture: [
          [0, 150],
          [3, 20],
        ],
        serviceIndexes: [0, 1, 3],
        packageIndex: 1,
        cateringGuests: 300,
        items: [
          ['Appetizers & Starters', 'Corn & Cheese Croquettes'],
          ['Royal Main Course', 'Subz Biryani'],
          ['Dessert Boutique', 'Gulab Jamun'],
          ['Live Counters', 'Pasta Live Counter'],
        ],
      },
      {
        customer: customerIds[2],
        eventType: 'Corporate Annual Leadership Summit',
        eventDate: isoDate(7),
        eventTime: '10:00',
        guests: 250,
        status: 'confirmed',
        hallIndex: 1,
        rooms: [
          [0, 1],
          [2, 5],
        ],
        stageIndex: 1,
        furniture: [
          [0, 200],
          [1, 20],
        ],
        serviceIndexes: [0, 2],
        packageIndex: 1,
        cateringGuests: 250,
        items: [
          ['Appetizers & Starters', 'Paneer Tikka Angara'],
          ['Royal Main Course', 'Kashmiri Dum Pulao'],
          ['Live Counters', 'Tandoori Grill Counter'],
        ],
      },
      {
        customer: customerIds[3],
        eventType: 'Traditional Engagement & Ring Ceremony',
        eventDate: isoDate(35),
        eventTime: '17:00',
        guests: 200,
        status: 'pending',
        hallIndex: 2,
        rooms: [
          [2, 2],
          [1, 1],
        ],
        stageIndex: 2,
        furniture: [
          [0, 120],
          [1, 15],
        ],
        serviceIndexes: [1],
        packageIndex: 2,
        cateringGuests: 200,
        items: [
          ['Appetizers & Starters', 'Dahi Ke Kebab'],
          ['Royal Main Course', 'Paneer Lababdar'],
          ['Dessert Boutique', 'Kesari Jalebi Live Counter'],
        ],
      },
      {
        customer: customerIds[4],
        eventType: 'Destination Wedding Reception',
        eventDate: isoDate(45),
        eventTime: '18:30',
        guests: 500,
        status: 'pending',
        hallIndex: 3,
        rooms: [
          [0, 2],
          [2, 6],
          [1, 1],
        ],
        stageIndex: 0,
        furniture: [
          [0, 300],
          [1, 30],
        ],
        serviceIndexes: [0, 2, 3],
        packageIndex: 0,
        cateringGuests: 500,
        items: [
          ['Appetizers & Starters', 'Paneer Tikka Angara'],
          ['Royal Main Course', 'Kashmiri Dum Pulao'],
          ['Dessert Boutique', 'Shahi Tukda with Rabri'],
        ],
      },
    ];

    for (const booking of bookingSeed) {
      const hallId = hallIds[booking.hallIndex];
      const hallPrice = hallSeed[booking.hallIndex].price;
      const roomTotal = booking.rooms.reduce(
        (sum, [roomIndex, quantity]) => sum + roomSeed[roomIndex].price * quantity,
        0,
      );
      const furnitureIds = furnitureByHall[booking.hallIndex];
      const furnitureTotal = booking.furniture.reduce(
        (sum, [itemIndex, quantity]) => sum + [25_000, 85_000, 500_000, 40_000][itemIndex] * quantity,
        0,
      );
      const stageId = stagesByHall[booking.hallIndex][booking.stageIndex];
      const stagePrice = [6_500_000, 8_500_000, 4_500_000][booking.stageIndex];
      const servicePrices = [4_500_000, 3_000_000, 3_500_000, 2_000_000];
      const selectedServices = booking.serviceIndexes.map((index) => ({
        id: servicesByHall[booking.hallIndex][index],
        price: servicePrices[index],
      }));
      const serviceTotal = selectedServices.reduce((sum, service) => sum + service.price, 0);
      const packageId = packageIds[booking.packageIndex];
      const perPlate = cateringSeed[booking.packageIndex].price;
      const cateringTotal = perPlate * booking.cateringGuests;
      const total = hallPrice + roomTotal + furnitureTotal + stagePrice + serviceTotal + cateringTotal;

      const bookingId = insert(
        `INSERT INTO bookings (customer_id, access_token, event_date, event_time, event_type, total_guest, special_request, status, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          booking.customer,
          randomBytes(18).toString('base64url'),
          booking.eventDate,
          booking.eventTime,
          booking.eventType,
          booking.guests,
          'Please coordinate a venue walkthrough two weeks before the event.',
          booking.status,
          total,
        ],
      );

      insert(`INSERT INTO booking_halls (booking_id, hall_id, price) VALUES (?, ?, ?)`, [
        bookingId,
        hallId,
        hallPrice,
      ]);

      for (const [roomIndex, quantity] of booking.rooms) {
        insert(
          `INSERT INTO booking_rooms (booking_id, room_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)`,
          [bookingId, roomIds[roomIndex], quantity, roomSeed[roomIndex].price, roomSeed[roomIndex].price * quantity],
        );
      }

      for (const [itemIndex, quantity] of booking.furniture) {
        const price = [25_000, 85_000, 500_000, 40_000][itemIndex];
        insert(
          `INSERT INTO booking_furniture (booking_id, furniture_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)`,
          [bookingId, furnitureIds[itemIndex], quantity, price, price * quantity],
        );
      }

      insert(`INSERT INTO booking_stages (booking_id, stage_id, price) VALUES (?, ?, ?)`, [
        bookingId,
        stageId,
        stagePrice,
      ]);

      for (const service of selectedServices) {
        insert(`INSERT INTO booking_services (booking_id, service_id, price) VALUES (?, ?, ?)`, [
          bookingId,
          service.id,
          service.price,
        ]);
      }

      const bookingCateringId = insert(
        `INSERT INTO booking_catering (booking_id, package_id, guest_count, price_per_plate, total_price)
         VALUES (?, ?, ?, ?, ?)`,
        [bookingId, packageId, booking.cateringGuests, perPlate, cateringTotal],
      );

      for (const [section, item] of booking.items) {
        insert(
          `INSERT INTO booking_menu_items (booking_catering_id, section, item_name) VALUES (?, ?, ?)`,
          [bookingCateringId, section, item],
        );
      }
    }

    insert(
      `INSERT INTO contact_inquiries (name, phone, email, event_type, event_date, guest_count, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new')`,
      [
        'Neha Verma',
        '9911223344',
        'neha.verma@example.com',
        'Wedding',
        isoDate(60),
        350,
        'Looking for a December wedding with both hall and catering. Please share availability.',
      ],
    );
    insert(
      `INSERT INTO contact_inquiries (name, phone, email, event_type, event_date, guest_count, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'contacted')`,
      [
        'Sandeep Oraon',
        '9812340000',
        'sandeep@example.com',
        'Corporate Event',
        isoDate(28),
        120,
        'Annual dealer meet for 120 guests. Need stage, AV and lunch.',
      ],
    );

    /* ==================== Event Point Ranchi catalogue ==================== */

    const mandapSeed = [
      {
        name: 'Royal Rajputana Carved Mandap',
        slug: 'royal-rajputana-carved-mandap',
        description:
          'Hand-carved Shekhawati arches, brass inlay and deep maroon drapes create a stately backdrop for traditional pheras and family portraits.',
        image: '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
        category: 'Traditional Royal',
        length: 20,
        width: 20,
        height: 14,
        specs:
          'Carved MDF and timber arch frames · Antique brass pillars · Maroon and ivory silk drapes · Hand-painted motifs · Raised platform included',
        gallery: [
          '/images/archive/christian-lambert-vmIWr0NnpCQ-unsplash.jpg',
          '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg',
        ],
      },
      {
        name: 'Floating Floral Dome Mandap',
        slug: 'floating-floral-dome-mandap',
        description:
          'A suspended dome of fresh and preserved florals above a circular platform, designed to feel airy from every guest sightline.',
        image: '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg',
        category: 'Floral Ethereal',
        length: 18,
        width: 18,
        height: 15,
        specs:
          'Suspended floral dome · Circular wooden platform · Pastel roses, orchids and baby’s breath · Concealed warm lighting · Shear drape curtains',
        gallery: [
          '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg',
          '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
        ],
      },
      {
        name: 'Temple Pillar Mandap',
        slug: 'temple-pillar-mandap',
        description:
          'South Indian temple-inspired pillars in warm ivory and gold, with a carved ceiling panel and a low, intimate seating plan.',
        image: '/images/archive/christian-lambert-vmIWr0NnpCQ-unsplash.jpg',
        category: 'Temple Heritage',
        length: 16,
        width: 16,
        height: 12,
        specs:
          'Four carved temple pillars · Ivory and gold palette · Brass hanging lamps · Marigold garland accents · Low seating platforms',
        gallery: [
          '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg',
          '/images/archive/manuel-moreno-DGa0LQ0yDPc-unsplash.jpg',
        ],
      },
      {
        name: 'Contemporary Glass & Gold Mandap',
        slug: 'contemporary-glass-gold-mandap',
        description:
          'Clean geometric lines, fluted glass panels and brushed-gold framing for couples who want a modern, editorial ceremony setting.',
        image: '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg',
        category: 'Contemporary Luxe',
        length: 22,
        width: 16,
        height: 14,
        specs:
          'Fluted glass panels · Brushed-gold metal frame · Mirror-finish platform · White and champagne florals · Dimmable pinspot lighting',
        gallery: [
          '/images/archive/linus-mimietz-p3UWyaujtQo-unsplash.jpg',
          '/images/archive/point3d-commercial-imaging-ltd-oxeCZrodz78-unsplash.jpg',
        ],
      },
      {
        name: 'Lotus Blossom Mandap',
        slug: 'lotus-blossom-mandap',
        description:
          'Layered lotus-inspired petals in blush and ivory frame the couple, with a low floral base and soft candlelight.',
        image: '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg',
        category: 'Floral Ethereal',
        length: 18,
        width: 18,
        height: 13,
        specs:
          'Lotus-petal arch structure · Blush and ivory florals · Candle and diya cluster · Low circular platform · Optional petal aisle',
        gallery: [
          '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg',
          '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg',
        ],
      },
      {
        name: 'Pastel Floral Canopy Mandap',
        slug: 'pastel-floral-canopy-mandap',
        description:
          'A soft canopy of pastel blooms, hanging fabric and fairy lights that suits daytime lawns and intimate courtyard ceremonies.',
        image: '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg',
        category: 'Floral Ethereal',
        length: 16,
        width: 16,
        height: 12,
        specs:
          'Pastel floral canopy · Hanging fabric panels · Warm fairy lights · Lightweight timber frame · Indoor or lawn installation',
        gallery: [
          '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
          '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg',
        ],
      },
    ];

    const mandapIds: number[] = [];
    for (const [index, mandap] of mandapSeed.entries()) {
      const id = insert(
        `INSERT INTO mandaps (name, slug, description, image, category, length_ft, width_ft, height_ft, material_specs, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mandap.name,
          mandap.slug,
          mandap.description,
          mandap.image,
          mandap.category,
          mandap.length,
          mandap.width,
          mandap.height,
          mandap.specs,
          index + 1,
        ],
      );
      mandapIds.push(id);
      mandap.gallery.forEach((image, galleryIndex) => {
        insert('INSERT INTO mandap_gallery (mandap_id, image, sort) VALUES (?, ?, ?)', [
          id,
          image,
          galleryIndex + 1,
        ]);
      });
    }

    const stageSeed = [
      {
        name: 'Majestic Royal Reception Stage',
        slug: 'majestic-royal-reception-stage',
        description:
          'Tiered royal staging with carved panels, velvet drapes and a central throne setting for receptions and grand entrances.',
        image: '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg',
        category: 'Royal Reception',
        length: 28,
        width: 18,
        height: 15,
        notes:
          'Three-level platform · Carved side panels · Deep maroon velvet · Gold throne chairs · Warm wash lighting · Fresh floral edge',
        gallery: [
          '/images/archive/gerson-repreza-CepDpEiALqM-unsplash.jpg',
          '/images/archive/point3d-commercial-imaging-ltd-oxeCZrodz78-unsplash.jpg',
        ],
      },
      {
        name: 'Minimalist Geometric Floral Stage',
        slug: 'minimalist-geometric-floral-stage',
        description:
          'Architectural white panels softened with single-variety florals — a calm, contemporary stage that photographs beautifully.',
        image: '/images/archive/linus-mimietz-p3UWyaujtQo-unsplash.jpg',
        category: 'Modern Minimal',
        length: 24,
        width: 16,
        height: 14,
        notes:
          'Matte white geometric backdrop · Monochrome floral clusters · Low platform · Concealed uplighting · Optional acrylic lectern',
        gallery: [
          '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg',
          '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg',
        ],
      },
      {
        name: 'Grand Mughal Backdrop Stage',
        slug: 'grand-mughal-backdrop-stage',
        description:
          'Jali screens, scalloped arches and jewel-toned drapes for a reception that feels rooted in Mughal courtly design.',
        image: '/images/archive/gerson-repreza-CepDpEiALqM-unsplash.jpg',
        category: 'Mughal Heritage',
        length: 30,
        width: 20,
        height: 16,
        notes:
          'Hand-finished jali panels · Scalloped arch framing · Jewel-tone drapes · Brass lanterns · Raised carpeted platform · Floral garlands',
        gallery: [
          '/images/archive/christian-lambert-vmIWr0NnpCQ-unsplash.jpg',
          '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg',
        ],
      },
      {
        name: 'Modern LED Horizon Stage',
        slug: 'modern-led-horizon-stage',
        description:
          'A wide LED horizon wall with clean lines and programmable lighting for sangeet nights, receptions and corporate celebrations.',
        image: '/images/archive/point3d-commercial-imaging-ltd-oxeCZrodz78-unsplash.jpg',
        category: 'Contemporary LED',
        length: 32,
        width: 18,
        height: 14,
        notes:
          'P3 LED wall · Programmable content · Truss lighting · Mirror stage top · DJ riser · Cable-managed installation',
        gallery: [
          '/images/archive/linus-mimietz-p3UWyaujtQo-unsplash.jpg',
          '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg',
        ],
      },
      {
        name: 'Botanical Gardenia Stage',
        slug: 'botanical-gardenia-stage',
        description:
          'Lush green foliage, white gardenias and natural textures bring a garden conservatory feel to indoor and lawn venues.',
        image: '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg',
        category: 'Botanical',
        length: 26,
        width: 16,
        height: 14,
        notes:
          'Foliage wall · White gardenia and rose clusters · Natural jute runner · Warm bulb lighting · Timber platform · Potted plant border',
        gallery: [
          '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg',
          '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
        ],
      },
      {
        name: 'Regal Ivory & Gold Stage',
        slug: 'regal-ivory-gold-stage',
        description:
          'An ivory and antique-gold stage with layered drapes and classical detailing for engagements and formal receptions.',
        image: '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
        category: 'Classic Elegance',
        length: 26,
        width: 18,
        height: 15,
        notes:
          'Layered ivory drapes · Antique-gold trim · Classical sofa seating · Candelabra cluster · Fresh white florals · Warm pinspots',
        gallery: [
          '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg',
          '/images/archive/christian-lambert-vmIWr0NnpCQ-unsplash.jpg',
        ],
      },
    ];

    const stageIds: number[] = [];
    for (const [index, stage] of stageSeed.entries()) {
      const id = insert(
        `INSERT INTO stages (name, slug, description, image, style_category, length_ft, width_ft, height_ft, decoration_notes, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          stage.name,
          stage.slug,
          stage.description,
          stage.image,
          stage.category,
          stage.length,
          stage.width,
          stage.height,
          stage.notes,
          index + 1,
        ],
      );
      stageIds.push(id);
      stage.gallery.forEach((image, galleryIndex) => {
        insert('INSERT INTO stage_gallery (stage_id, image, sort) VALUES (?, ?, ?)', [
          id,
          image,
          galleryIndex + 1,
        ]);
      });
    }

    const equipmentSeed = [
      {
        name: 'Chairs',
        slug: 'chairs',
        icon: 'chair',
        items: [
          ['Golden Chiavari Chair', 'golden-chiavari-chair', 'Classic gold-finished Chiavari frame with a comfortable velvet cushion for banquet seating.', 'piece', 'Gold frame · Velvet or satin cushion · Stackable · Indoor use', 50, 250],
          ['Ivory Padded Banquet Chair', 'ivory-padded-banquet-chair', 'Neutral ivory banquet chair with a padded seat and back for long ceremonies.', 'piece', 'Ivory fabric · Padded back · Powder-coated frame · Stackable', 50, 300],
          ['Maharaja High-Back Chair', 'maharaja-high-back-chair', 'Statement high-back chair for the couple, elders and formal photo settings.', 'piece', 'Carved frame · Brocade upholstery · High back · Gold finish', 2, 2],
          ['Rustic Cross-Back Chair', 'rustic-cross-back-chair', 'Natural wood cross-back chair for outdoor, mehendi and garden settings.', 'piece', 'Solid wood · Natural finish · Cross-back · Weather-ready', 25, 100],
        ],
      },
      {
        name: 'Tables',
        slug: 'tables',
        icon: 'table',
        items: [
          ['Round 10-Seater Banquet Table', 'round-10-seater-banquet-table', 'Round banquet table with linen and seating for ten guests.', 'table', '72-inch diameter · 10 seats · Floor-length linen · Centrepiece ready', 5, 30],
          ['Rectangular Buffet Table', 'rectangular-buffet-table', 'Six-foot buffet table with a clean skirt and serving surface.', 'table', '6 ft × 2.5 ft · Skirted · Serving surface · Modular layout', 2, 6],
          ['Cocktail High-Top Table', 'cocktail-high-top-table', 'High-top cocktail table for receptions and social-hour layouts.', 'table', 'Bar-height · Round or square top · Linen optional · Standing service', 4, 12],
          ['Brass Accent Side Table', 'brass-accent-side-table', 'Small brass side table for lounge clusters and photo corners.', 'piece', 'Antique brass finish · 18-inch top · Decorative accent', 2, 8],
        ],
      },
      {
        name: 'Sofas & Lounge Seating',
        slug: 'sofas-lounge-seating',
        icon: 'sofa',
        items: [
          ['Royal Maharaja Two-Seater Sofa', 'royal-maharaja-two-seater-sofa', 'Carved two-seater sofa with jewel-tone upholstery for stage and lounge settings.', 'set', 'Carved timber frame · Velvet upholstery · Two seats · Gold detailing', 1, 2],
          ['Ivory Velvet Lounge Sofa', 'ivory-velvet-lounge-sofa', 'Soft ivory velvet sofa that works with both modern and classical palettes.', 'set', 'Ivory velvet · Hardwood frame · Three seats · Cushions included', 1, 3],
          ['Brass-Frame Lounge Chair', 'brass-frame-lounge-chair', 'Open brass-frame lounge chair for stylish seating clusters.', 'piece', 'Brass frame · Upholstered seat · Lounge height · Indoor use', 2, 8],
          ['Ottoman & Coffee Table Set', 'ottoman-coffee-table-set', 'Coordinated ottoman and coffee table set for lounge corners.', 'set', 'Ottoman · Coffee table · Matching finish · Modular layout', 1, 4],
        ],
      },
      {
        name: 'Decorative Furniture',
        slug: 'decorative-furniture',
        icon: 'flower',
        items: [
          ['Carved Wooden Bridal Bench', 'carved-wooden-bridal-bench', 'Carved bridal bench for getting-ready photographs and mehendi setups.', 'piece', 'Hand-carved wood · Cushioned seat · Gold and ivory finish', 1, 1],
          ['Floral Swing Jhula', 'floral-swing-jhula', 'Hanging floral jhula for bridal entries, mehendi and photo moments.', 'set', 'Floral canopy · Cushioned seat · Metal frame · Installation included', 1, 1],
          ['Brass Urli & Diya Stand', 'brass-urli-diya-stand', 'Traditional brass urli with a diya arrangement for entrances and mandap edges.', 'piece', 'Brass finish · Floating florals · Diya cluster · Various sizes', 2, 6],
          ['Decorative Pheras Screen', 'decorative-pheras-screen', 'Freestanding carved screen used to frame the pheras area or disguise service zones.', 'set', 'Carved panels · Maroon and gold finish · Modular · Freestanding', 1, 4],
        ],
      },
      {
        name: 'Lighting & Backdrops',
        slug: 'lighting-backdrops',
        icon: 'light',
        items: [
          ['Warm Fairy Light Canopy', 'warm-fairy-light-canopy', 'Warm-white fairy light canopy for lawns, courtyards and evening celebrations.', 'set', 'Warm white bulbs · Weatherproof cable · Canopy or curtain install', 1, 4],
          ['Crystal Chandelier Cluster', 'crystal-chandelier-cluster', 'Cluster of crystal chandeliers for reception ceilings and stage highlights.', 'set', 'Crystal finish · Warm bulbs · Rigging included · Indoor use', 1, 3],
          ['Uplighting & Pinspot Package', 'uplighting-pinspot-package', 'Uplighting and pinspots to shape the room and highlight floral and stage details.', 'set', 'LED uplights · Pinspots · DMX control · Installation included', 1, 1],
          ['Custom Floral Backdrop Panel', 'custom-floral-backdrop-panel', 'Made-to-size floral backdrop panel for photo walls and reception entrances.', 'panel', '8 ft × 8 ft standard · Fresh or preserved florals · Custom sizing', 1, 2],
        ],
      },
      {
        name: 'Other Event Essentials',
        slug: 'other-event-essentials',
        icon: 'box',
        items: [
          ['Mandap Carpet & Aisle Runner', 'mandap-carpet-aisle-runner', 'Carpet and aisle runner sized to your mandap and seating layout.', 'roll', 'Custom length · Non-slip backing · Ivory, maroon or blush', 1, 2],
          ['Welcome Signage Easel', 'welcome-signage-easel', 'Wooden or brass easel for welcome boards and seating signage.', 'piece', 'Timber or brass · Adjustable height · Signage board optional', 1, 4],
          ['Shehnai & Dhol Artist Stand', 'shehnai-dhol-artist-stand', 'Performance platform and seating for shehnai, dhol and ceremonial musicians.', 'set', 'Low platform · Artist seating · Power access · Weather cover', 1, 1],
          ['Guest Umbrella & Fan Station', 'guest-umbrella-fan-station', 'Shade and cooling station for outdoor ceremonies and guest comfort.', 'set', 'Umbrellas · Fans · Attendant stand · Weather-ready', 1, 2],
        ],
      },
    ] as const;

    const equipmentIds: number[] = [];
    for (const [categoryIndex, category] of equipmentSeed.entries()) {
      const categoryId = insert(
        'INSERT INTO equipment_categories (name, slug, icon, sort) VALUES (?, ?, ?, ?)',
        [category.name, category.slug, category.icon, categoryIndex + 1],
      );
      for (const [itemIndex, item] of category.items.entries()) {
        const [name, slug, description, unit, specifications, minQuantity, defaultQuantity] = item;
        equipmentIds.push(
          insert(
            `INSERT INTO equipment_items
               (category_id, name, slug, description, unit, specifications, min_quantity, default_quantity, sort)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              categoryId,
              name,
              slug,
              description,
              unit,
              specifications,
              minQuantity,
              defaultQuantity,
              itemIndex + 1,
            ],
          ),
        );
      }
    }

    interface SampleEnquiry {
      reference: string;
      name: string;
      phone: string;
      email: string;
      eventType: string;
      eventDate: string;
      endDate: string | null;
      eventTime: string;
      venue: string;
      guests: number;
      budget: string;
      requiresRooms: number;
      roomCount: number;
      accommodationNotes: string;
      decorationNotes: string;
      preferredContact: string;
      status: string;
      lines: Array<{
        type: string;
        catalogueId: number | null;
        name: string;
        quantity: number;
        dimensions: string;
        length: number | null;
        width: number | null;
        height: number | null;
        specifications: string;
        notes: string;
      }>;
    }

    const sampleEnquiries: SampleEnquiry[] = [
      {
        reference: 'EP-2026-0001',
        name: 'Ritika Mahto',
        phone: '9876543211',
        email: 'ritika.mahto@example.com',
        eventType: 'Wedding',
        eventDate: isoDate(42),
        endDate: isoDate(43),
        eventTime: '18:30',
        venue: 'Harmu Ground, Ranchi',
        guests: 350,
        budget: '₹7,00,000 – ₹15,00,000',
        requiresRooms: 1,
        roomCount: 20,
        accommodationNotes: 'Need nearby guest rooms for family travelling from Dhanbad and Jamshedpur.',
        decorationNotes: 'Maroon, ivory and antique gold palette. Evening ceremony with warm lighting.',
        preferredContact: 'WhatsApp',
        status: 'new',
        lines: [
          {
            type: 'mandap',
            catalogueId: mandapIds[0] ?? null,
            name: mandapSeed[0].name,
            quantity: 1,
            dimensions: '20 ft × 20 ft × 14 ft',
            length: 22,
            width: 22,
            height: 14,
            specifications: mandapSeed[0].specs,
            notes: 'Widen to 22 ft to accommodate the family seating.',
          },
          {
            type: 'stage',
            catalogueId: stageIds[0] ?? null,
            name: stageSeed[0].name,
            quantity: 1,
            dimensions: '28 ft × 18 ft × 15 ft',
            length: null,
            width: null,
            height: null,
            specifications: stageSeed[0].notes,
            notes: '',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[0] ?? null,
            name: 'Golden Chiavari Chair',
            quantity: 300,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: 'Gold frame · Velvet or satin cushion · Stackable · Indoor use',
            notes: '',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[4] ?? null,
            name: 'Round 10-Seater Banquet Table',
            quantity: 30,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: '72-inch diameter · 10 seats · Floor-length linen · Centrepiece ready',
            notes: '',
          },
        ],
      },
      {
        reference: 'EP-2026-0002',
        name: 'Abhishek Singh',
        phone: '9812345670',
        email: 'abhishek.singh@example.com',
        eventType: 'Reception',
        eventDate: isoDate(68),
        endDate: null,
        eventTime: '19:00',
        venue: 'Kanke Road Banquet Lawn, Ranchi',
        guests: 500,
        budget: 'Above ₹15,00,000',
        requiresRooms: 1,
        roomCount: 30,
        accommodationNotes: 'Thirty rooms for two nights, preferably within 15 minutes of the venue.',
        decorationNotes: 'Jewel tones with a Mughal-inspired stage and extensive warm uplighting.',
        preferredContact: 'Phone',
        status: 'reviewing',
        lines: [
          {
            type: 'stage',
            catalogueId: stageIds[2] ?? null,
            name: stageSeed[2].name,
            quantity: 1,
            dimensions: '30 ft × 20 ft × 16 ft',
            length: 34,
            width: 22,
            height: 16,
            specifications: stageSeed[2].notes,
            notes: 'Extend width for a 12-piece band.',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[1] ?? null,
            name: 'Ivory Padded Banquet Chair',
            quantity: 500,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: 'Ivory fabric · Padded back · Powder-coated frame · Stackable',
            notes: '',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[17] ?? null,
            name: 'Crystal Chandelier Cluster',
            quantity: 6,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: 'Crystal finish · Warm bulbs · Rigging included · Indoor use',
            notes: 'Suspend along the central walkway.',
          },
        ],
      },
      {
        reference: 'EP-2026-0003',
        name: 'Sneha Kujur',
        phone: '9823456780',
        email: 'sneha.kujur@example.com',
        eventType: 'Engagement',
        eventDate: isoDate(24),
        endDate: null,
        eventTime: '17:00',
        venue: 'Event Point Studio, Main Road, Ranchi',
        guests: 180,
        budget: '₹3,00,000 – ₹7,00,000',
        requiresRooms: 0,
        roomCount: 0,
        accommodationNotes: '',
        decorationNotes: 'Pastel palette, intimate ceremony, plenty of fresh flowers and soft daylight.',
        preferredContact: 'Email',
        status: 'quoted',
        lines: [
          {
            type: 'mandap',
            catalogueId: mandapIds[5] ?? null,
            name: mandapSeed[5].name,
            quantity: 1,
            dimensions: '16 ft × 16 ft × 12 ft',
            length: null,
            width: null,
            height: null,
            specifications: mandapSeed[5].specs,
            notes: '',
          },
          {
            type: 'stage',
            catalogueId: stageIds[5] ?? null,
            name: stageSeed[5].name,
            quantity: 1,
            dimensions: '26 ft × 18 ft × 15 ft',
            length: null,
            width: null,
            height: null,
            specifications: stageSeed[5].notes,
            notes: '',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[16] ?? null,
            name: 'Warm Fairy Light Canopy',
            quantity: 2,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: 'Warm white bulbs · Weatherproof cable · Canopy or curtain install',
            notes: '',
          },
        ],
      },
      {
        reference: 'EP-2026-0004',
        name: 'Pooja Agarwal',
        phone: '9934567890',
        email: 'pooja.agarwal@example.com',
        eventType: 'Wedding',
        eventDate: isoDate(95),
        endDate: isoDate(96),
        eventTime: '11:00',
        venue: 'Morabadi Ground, Ranchi',
        guests: 220,
        budget: '₹3,00,000 – ₹7,00,000',
        requiresRooms: 0,
        roomCount: 0,
        accommodationNotes: '',
        decorationNotes: 'Daytime temple-inspired ceremony, marigold and brass accents.',
        preferredContact: 'Phone',
        status: 'confirmed',
        lines: [
          {
            type: 'mandap',
            catalogueId: mandapIds[2] ?? null,
            name: mandapSeed[2].name,
            quantity: 1,
            dimensions: '16 ft × 16 ft × 12 ft',
            length: null,
            width: null,
            height: null,
            specifications: mandapSeed[2].specs,
            notes: 'Add extra marigold garlands on the entrance pillars.',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[22] ?? null,
            name: 'Shehnai & Dhol Artist Stand',
            quantity: 1,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: 'Low platform · Artist seating · Power access · Weather cover',
            notes: '',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[14] ?? null,
            name: 'Brass Urli & Diya Stand',
            quantity: 6,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: 'Brass finish · Floating florals · Diya cluster · Various sizes',
            notes: '',
          },
        ],
      },
      {
        reference: 'EP-2026-0005',
        name: 'Vikash Prasad',
        phone: '9765432109',
        email: '',
        eventType: 'Sangeet',
        eventDate: isoDate(10),
        endDate: null,
        eventTime: '20:00',
        venue: 'Lalpur Community Hall, Ranchi',
        guests: 260,
        budget: '₹1,00,000 – ₹3,00,000',
        requiresRooms: 0,
        roomCount: 0,
        accommodationNotes: '',
        decorationNotes: 'LED stage with dance floor and a bright, high-energy lighting brief.',
        preferredContact: 'WhatsApp',
        status: 'archived',
        lines: [
          {
            type: 'stage',
            catalogueId: stageIds[3] ?? null,
            name: stageSeed[3].name,
            quantity: 1,
            dimensions: '32 ft × 18 ft × 14 ft',
            length: null,
            width: null,
            height: null,
            specifications: stageSeed[3].notes,
            notes: 'Content requirements to be shared one week before.',
          },
          {
            type: 'equipment',
            catalogueId: equipmentIds[18] ?? null,
            name: 'Uplighting & Pinspot Package',
            quantity: 1,
            dimensions: '',
            length: null,
            width: null,
            height: null,
            specifications: 'LED uplights · Pinspots · DMX control · Installation included',
            notes: '',
          },
        ],
      },
    ];

    for (const enquiry of sampleEnquiries) {
      const enquiryId = insert(
        `INSERT INTO event_enquiries
           (reference_code, customer_name, customer_phone, customer_email, event_type, event_date, end_date,
            event_time, venue_location, guest_count, budget_range, requires_rooms, room_count,
            accommodation_notes, decoration_notes, preferred_contact, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          enquiry.reference,
          enquiry.name,
          enquiry.phone,
          enquiry.email || null,
          enquiry.eventType,
          enquiry.eventDate,
          enquiry.endDate,
          enquiry.eventTime,
          enquiry.venue,
          enquiry.guests,
          enquiry.budget,
          enquiry.requiresRooms,
          enquiry.roomCount,
          enquiry.accommodationNotes,
          enquiry.decorationNotes,
          enquiry.preferredContact,
          enquiry.status,
        ],
      );

      for (const line of enquiry.lines) {
        insert(
          `INSERT INTO enquiry_line_items
             (enquiry_id, item_type, catalogue_item_id, item_name_snapshot, quantity,
              standard_dimensions_snapshot, requested_length_ft, requested_width_ft, requested_height_ft,
              specifications, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            enquiryId,
            line.type,
            line.catalogueId,
            line.name,
            line.quantity,
            line.dimensions,
            line.length,
            line.width,
            line.height,
            line.specifications,
            line.notes,
          ],
        );
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
