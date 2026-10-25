export const site = {
  name: 'Royal Palace',
  legalName: 'Royal Palace Event Management',
  tagline: 'Luxury venues, curated catering, and effortless celebrations.',
  shortDescription:
    'Banquet halls, bridal suites, catering packages and event planning in Ranchi, Jharkhand.',
  location: 'Ranchi, Jharkhand',
  phone: '+91 98765 43210',
  email: 'info@royalpalace.com',
  address: 'Royal Palace Event Management, Kanke Road, Ranchi, Jharkhand 834008',
  venueAddress: 'Near City Mall, Ranchi (Jharkhand)',
  currency: 'INR',
  locale: 'en-IN',
  logo: '/images/logo1.png',
  social: [
    { label: 'Facebook', href: '#' },
    { label: 'Instagram', href: '#' },
    { label: 'YouTube', href: '#' },
    { label: 'LinkedIn', href: '#' },
  ],
} as const;

export const bookingStatuses = ['draft', 'pending', 'confirmed', 'cancelled'] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

export const eventTypes = [
  'Wedding',
  'Reception',
  'Nikkah',
  'Engagement',
  'Birthday',
  'Anniversary',
  'Corporate Event',
  'Conference',
  'Other',
] as const;

export const roomAmenityFallback = ['Air Conditioning', 'High-Speed Wi-Fi', 'Attached Bathroom'];
