import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './password';

type SqlValue = string | number | null;

function isoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

export function seedDatabase(db: DatabaseSync): void {
  const insert = (sql: string, params: SqlValue[] = []): number =>
    Number(db.prepare(sql).run(...params).lastInsertRowid);

  db.exec('BEGIN');
  try {
    insert(
      `INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, ?)`,
      ['admin', 'admin@royalpalace.com', hashPassword('Admin@Royal2026!'), 'Root', 'developer'],
    );
    insert(
      `INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, ?)`,
      ['superadmin', 'superadmin@royalpalace.com', hashPassword('Super@Royal2026!'), 'Vikramaditya', 'superadmin'],
    );
    insert(
      `INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, ?)`,
      ['event_manager', 'manager@royalpalace.com', hashPassword('Manager@Royal2026!'), 'Rajesh', 'admin'],
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
      ['Weddings', 'weddings'],
      ['Receptions', 'receptions'],
      ['Corporate', 'corporate'],
      ['Celebrations', 'celebrations'],
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
      [0, 'The Grand Kohinoor Ballroom', '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg'],
      [0, 'Floral Mandap Elegance', '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg'],
      [0, 'Golden Hour Vows', '/images/archive/fernando-alvarez-rodriguez-M7GddPqJowg-unsplash.jpg'],
      [1, 'Crystal Palace Reception', '/images/archive/gerson-repreza-CepDpEiALqM-unsplash.jpg'],
      [1, 'Heritage Courtyard Evening', '/images/archive/vojtech-bruzek-Yrxr3bsPdS0-unsplash.jpg'],
      [2, 'Leadership Summit Stage', '/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg'],
      [2, 'Executive Networking Lounge', '/images/archive/linus-mimietz-p3UWyaujtQo-unsplash.jpg'],
      [3, 'Garden Sangeet Night', '/images/archive/valeriia-bugaiova-_pPHgeHz1uk-unsplash.jpg'],
      [3, 'Royal Table Setting', '/images/archive/manuel-moreno-DGa0LQ0yDPc-unsplash.jpg'],
      [3, 'Dessert Boutique Display', '/images/archive/sara-dubler-Koei_7yYtIo-unsplash.jpg'],
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
        'Where Your Grandest Celebrations Become Royal Memories',
        'Four signature venues, bridal suites, in-house catering and a planning team that handles every detail — all under one roof in Ranchi.',
        '/images/archive/fernando-alvarez-rodriguez-M7GddPqJowg-unsplash.jpg',
      ],
    );

    const homeFeatures = [
      ['building', 'Four Signature Venues', 'From an 800-guest ballroom to an open-air garden lawn.'],
      ['utensils', 'In-House Catering', 'Menus built with you, prepared fresh by our kitchen brigade.'],
      ['sparkles', 'Signature Décor', 'Stage, floral and lighting concepts designed in-house.'],
      ['shield', 'One Dedicated Planner', 'A single point of contact from first visit to final farewell.'],
    ] as const;
    homeFeatures.forEach(([icon, title, description], index) => {
      insert(
        `INSERT INTO homepage_features (icon, title, description, sort) VALUES (?, ?, ?, ?)`,
        [icon, title, description, index + 1],
      );
    });

    insert(`INSERT INTO contact_info (id, address, phone, email) VALUES (1, ?, ?, ?)`, [
      'Royal Palace Event Management, Kanke Road, Ranchi, Jharkhand 834008',
      '+91 98765 43210',
      'info@royalpalace.com',
    ]);

    const pages = [
      ['halls', 'Our Premium Banquet Halls', 'Discover the perfect venue for weddings, receptions and corporate celebrations.', 'LUXURY VENUES', '/images/archive/visualsofdana-T5pL6ciEn-I-unsplash.jpg'],
      ['rooms', 'Rooms & Bridal Suites', 'Comfortable, premium stays for your family and guests.', 'LUXURY STAY', '/images/archive/sasha-kaunas-TAgGZWz6Qg8-unsplash.jpg'],
      ['catering', 'Catering Packages', 'Select the perfect menu for your event, prepared fresh by our kitchen.', 'CURATED MENUS', '/images/archive/manuel-moreno-DGa0LQ0yDPc-unsplash.jpg'],
      ['gallery', 'Moments From Royal Palace', 'A look inside the celebrations we have hosted.', 'THE COLLECTION', '/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg'],
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

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
