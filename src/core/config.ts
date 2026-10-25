export const site = {
  name: 'Event Point',
  legalName: 'Event Point Ranchi',
  tagline: 'Wedding Mandap, Stage Designs, Furniture & Event Equipment Planning',
  shortDescription:
    'Wedding mandaps, stage designs, furniture and event equipment planning in Ranchi, Jharkhand.',
  location: 'Ranchi, Jharkhand, India',
  phone: '+91 98765 43210',
  email: 'info@eventpointranchi.com',
  address: 'Event Point, Main Road, Ranchi, Jharkhand 834001, India',
  venueAddress: 'Main Road, Ranchi (Jharkhand)',
  whatsapp: '919876543210',
  currency: 'INR',
  locale: 'en-IN',
  logo: '/images/event-point-logo.svg',
  social: [
    { label: 'Facebook', href: '#' },
    { label: 'Instagram', href: '#' },
    { label: 'YouTube', href: '#' },
    { label: 'Pinterest', href: '#' },
  ],
} as const;

export const bookingStatuses = ['draft', 'pending', 'confirmed', 'cancelled'] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

export const enquiryStatuses = ['new', 'reviewing', 'quoted', 'confirmed', 'archived'] as const;
export type EnquiryStatus = (typeof enquiryStatuses)[number];

export const eventTypes = [
  'Wedding',
  'Reception',
  'Engagement',
  'Sangeet',
  'Haldi',
  'Mehendi',
  'Nikkah',
  'Anniversary',
  'Birthday',
  'Corporate Event',
  'Other',
] as const;

export const budgetRanges = [
  'Under ₹1,00,000',
  '₹1,00,000 – ₹3,00,000',
  '₹3,00,000 – ₹7,00,000',
  '₹7,00,000 – ₹15,00,000',
  'Above ₹15,00,000',
  'Not sure yet',
] as const;

export const preferredContactMethods = ['Phone', 'WhatsApp', 'Email'] as const;

export const roomAmenityFallback = ['Air Conditioning', 'High-Speed Wi-Fi', 'Attached Bathroom'];
