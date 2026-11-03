import { defineModule } from '../../core/define-module';
import { paymentsEnabled } from '../../core/features';
import {
  cateringForm,
  cateringList,
  cateringListAction,
  contentAdmin,
  galleryAdmin,
  hallDelete,
  hallForm,
  hallToggle,
  hallsList,
} from './handlers/catalog';
import {
  adminLogin,
  adminLogout,
  bookingDetail,
  bookingsList,
  customerDetail,
  customersList,
  dashboard,
  legacyEnquiriesRedirect,
  legacyEnquiryDetailRedirect,
  newEnquiriesList,
  newEnquiryDetail,
  inquiriesList,
  paymentDetail,
  paymentsList,
  scanEnquiry,
} from './handlers/operations';
import BookingDetailPage from './pages/BookingDetailPage.astro';
import BookingsPage from './pages/BookingsPage.astro';
import CateringFormPage from './pages/CateringFormPage.astro';
import CateringPage from './pages/CateringPage.astro';
import ContentPage from './pages/ContentPage.astro';
import CustomerDetailPage from './pages/CustomerDetailPage.astro';
import CustomersPage from './pages/CustomersPage.astro';
import DashboardPage from './pages/DashboardPage.astro';
import NewEnquiriesPage from './pages/NewEnquiriesPage.astro';
import NewEnquiryDetailPage from './pages/NewEnquiryDetailPage.astro';
import GalleryAdminPage from './pages/GalleryAdminPage.astro';
import HallFormPage from './pages/HallFormPage.astro';
import HallsPage from './pages/HallsPage.astro';
import InquiriesPage from './pages/InquiriesPage.astro';
import LoginPage from './pages/LoginPage.astro';
import PaymentDetailPage from './pages/PaymentDetailPage.astro';
import PaymentsPage from './pages/PaymentsPage.astro';
import ScanEnquiryPage from './pages/ScanEnquiryPage.astro';

export default defineModule({
  id: 'admin',
  label: 'Admin',
  order: 90,
  adminNav: [
    { label: 'Dashboard', href: '/admin', icon: 'dashboard', order: 10 },
    { label: 'Bookings', href: '/admin/bookings', icon: 'ticket', order: 20 },
    ...(paymentsEnabled() ? [{ label: 'Payments', href: '/admin/payments', icon: 'credit-card', order: 22 }] : []),
    { label: 'New Enquiries', href: '/admin/new-enquiries', icon: 'calendar', order: 15 },
    { label: 'Enquiry QR Scanner', href: '/admin/enquiries/scan', icon: 'camera', order: 16 },
    { label: 'Halls', href: '/admin/halls', icon: 'building', order: 30 },
    { label: 'Catering', href: '/admin/catering', icon: 'utensils', order: 50 },
    { label: 'Gallery', href: '/admin/gallery', icon: 'image', order: 60 },
    { label: 'Customers', href: '/admin/customers', icon: 'users', order: 70 },
    { label: 'Contact Messages', href: '/admin/inquiries', icon: 'mail', order: 80 },
    { label: 'Content', href: '/admin/content', icon: 'settings', order: 90 },
  ],
  routes: [
    { path: '/admin/login', component: LoginPage, handle: adminLogin },
    { path: '/admin/logout', component: LoginPage, handle: adminLogout },
    { path: '/admin', component: DashboardPage, handle: dashboard },

    { path: '/admin/bookings', component: BookingsPage, handle: bookingsList },
    { path: '/admin/bookings/:id', component: BookingDetailPage, handle: bookingDetail },

    ...(paymentsEnabled()
      ? [
          { path: '/admin/payments', component: PaymentsPage, handle: paymentsList },
          { path: '/admin/payments/:id', component: PaymentDetailPage, handle: paymentDetail },
        ]
      : []),

    { path: '/admin/new-enquiries', component: NewEnquiriesPage, handle: newEnquiriesList },
    { path: '/admin/new-enquiries/:id', component: NewEnquiryDetailPage, handle: newEnquiryDetail },
    { path: '/admin/enquiries/scan', component: ScanEnquiryPage, handle: scanEnquiry },
    { path: '/admin/scanner', component: ScanEnquiryPage, handle: scanEnquiry },
    { path: '/admin/enquiries', component: NewEnquiriesPage, handle: legacyEnquiriesRedirect },
    { path: '/admin/enquiries/:id', component: NewEnquiryDetailPage, handle: legacyEnquiryDetailRedirect },

    { path: '/admin/halls', component: HallsPage, handle: hallsList },

    { path: '/admin/halls/new', component: HallFormPage, handle: hallForm },
    { path: '/admin/halls/:id', component: HallFormPage, handle: hallForm },
    { path: '/admin/halls/:id/toggle', component: HallsPage, handle: hallToggle },
    { path: '/admin/halls/:id/delete', component: HallsPage, handle: hallDelete },

    { path: '/admin/catering', component: CateringPage, handle: cateringList },
    { path: '/admin/catering/action', component: CateringPage, handle: cateringListAction },
    { path: '/admin/catering/new', component: CateringFormPage, handle: cateringForm },
    { path: '/admin/catering/:id', component: CateringFormPage, handle: cateringForm },

    { path: '/admin/gallery', component: GalleryAdminPage, handle: galleryAdmin },
    { path: '/admin/customers', component: CustomersPage, handle: customersList },
    { path: '/admin/customers/:id', component: CustomerDetailPage, handle: customerDetail },
    { path: '/admin/inquiries', component: InquiriesPage, handle: inquiriesList },
    { path: '/admin/content', component: ContentPage, handle: contentAdmin },

    { path: '/cms', component: DashboardPage, handle: dashboard },
  ],
});
