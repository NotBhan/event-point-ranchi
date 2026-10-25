import { defineModule } from '../../core/define-module';
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
  roomDelete,
  roomForm,
  roomToggle,
  roomsList,
} from './handlers/catalog';
import {
  adminLogin,
  adminLogout,
  bookingDetail,
  bookingsList,
  customerDetail,
  customersList,
  dashboard,
  eventEnquiriesList,
  eventEnquiryDetail,
  inquiriesList,
} from './handlers/operations';
import BookingDetailPage from './pages/BookingDetailPage.astro';
import BookingsPage from './pages/BookingsPage.astro';
import CateringFormPage from './pages/CateringFormPage.astro';
import CateringPage from './pages/CateringPage.astro';
import ContentPage from './pages/ContentPage.astro';
import CustomerDetailPage from './pages/CustomerDetailPage.astro';
import CustomersPage from './pages/CustomersPage.astro';
import DashboardPage from './pages/DashboardPage.astro';
import EventEnquiriesPage from './pages/EventEnquiriesPage.astro';
import EventEnquiryDetailPage from './pages/EventEnquiryDetailPage.astro';
import GalleryAdminPage from './pages/GalleryAdminPage.astro';
import HallFormPage from './pages/HallFormPage.astro';
import HallsPage from './pages/HallsPage.astro';
import InquiriesPage from './pages/InquiriesPage.astro';
import LoginPage from './pages/LoginPage.astro';
import RoomFormPage from './pages/RoomFormPage.astro';
import RoomsPage from './pages/RoomsPage.astro';

export default defineModule({
  id: 'admin',
  label: 'Admin',
  order: 90,
  adminNav: [
    { label: 'Dashboard', href: '/admin', icon: 'dashboard', order: 10 },
    { label: 'Bookings', href: '/admin/bookings', icon: 'ticket', order: 20 },
    { label: 'Event Enquiries', href: '/admin/enquiries', icon: 'calendar', order: 25 },
    { label: 'Halls', href: '/admin/halls', icon: 'building', order: 30 },
    { label: 'Rooms', href: '/admin/rooms', icon: 'bed', order: 40 },
    { label: 'Catering', href: '/admin/catering', icon: 'utensils', order: 50 },
    { label: 'Gallery', href: '/admin/gallery', icon: 'image', order: 60 },
    { label: 'Customers', href: '/admin/customers', icon: 'users', order: 70 },
    { label: 'Inquiries', href: '/admin/inquiries', icon: 'mail', order: 80 },
    { label: 'Content', href: '/admin/content', icon: 'settings', order: 90 },
  ],
  routes: [
    { path: '/admin/login', component: LoginPage, handle: adminLogin },
    { path: '/admin/logout', component: LoginPage, handle: adminLogout },
    { path: '/admin', component: DashboardPage, handle: dashboard },

    { path: '/admin/bookings', component: BookingsPage, handle: bookingsList },
    { path: '/admin/bookings/:id', component: BookingDetailPage, handle: bookingDetail },

    { path: '/admin/enquiries', component: EventEnquiriesPage, handle: eventEnquiriesList },
    { path: '/admin/enquiries/:id', component: EventEnquiryDetailPage, handle: eventEnquiryDetail },

    { path: '/admin/halls', component: HallsPage, handle: hallsList },
    { path: '/admin/halls/new', component: HallFormPage, handle: hallForm },
    { path: '/admin/halls/:id', component: HallFormPage, handle: hallForm },
    { path: '/admin/halls/:id/toggle', component: HallsPage, handle: hallToggle },
    { path: '/admin/halls/:id/delete', component: HallsPage, handle: hallDelete },

    { path: '/admin/rooms', component: RoomsPage, handle: roomsList },
    { path: '/admin/rooms/new', component: RoomFormPage, handle: roomForm },
    { path: '/admin/rooms/:id', component: RoomFormPage, handle: roomForm },
    { path: '/admin/rooms/:id/toggle', component: RoomsPage, handle: roomToggle },
    { path: '/admin/rooms/:id/delete', component: RoomsPage, handle: roomDelete },

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
