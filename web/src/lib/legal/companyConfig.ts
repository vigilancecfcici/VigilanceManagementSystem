/**
 * Company and legal configuration placeholders.
 * NOT legal advice — counsel must confirm placeholders marked CONFIRM_BEFORE_PRODUCTION.
 */

export const COMPANY = {
  legalName: 'CFC ICI Kerala',
  shortName: 'CFC ICI',
  platformName: 'Vigilance Management System',
  platformAbbrev: 'VMS',
  operationalRegion: 'Kerala, India',
  businessContext:
    'internal vigilance, inspection, compliance-support, and operational monitoring for authorised personnel',
  website: 'https://example.com',
  /** General company contact — NOT confirmed as privacy/DPO channel */
  generalPhone: '[Company Phone]',
  generalEmail: 'info@example.com',
} as const;

/** Replace with counsel-approved registered office before production */
export const REGISTERED_OFFICE_PLACEHOLDER =
  '[Registered / corporate office address — to be confirmed by Company]';

/** Replace with designated privacy / grievance contact before production */
export const PRIVACY_CONTACT_PLACEHOLDER =
  '[Privacy / grievance contact — to be confirmed by Company]';

export const PRIVACY_EMAIL_PLACEHOLDER = 'privacy@example.com [confirm before production]';

/**
 * Infrastructure providers evidenced in this repository (vercel.json, Supabase client, MapView, mobile push).
 */
export const TECHNICAL_SERVICE_PROVIDERS = [
  {
    name: 'Supabase, Inc.',
    purpose: 'Authentication, PostgreSQL database, object storage, realtime subscriptions, and edge functions',
  },
  {
    name: 'Vercel Inc.',
    purpose: 'Web application hosting and content delivery for the dashboard',
  },
  {
    name: 'OpenStreetMap contributors (via Leaflet)',
    purpose: 'Map tiles and geospatial display for branch / inspection context on the store map',
  },
  {
    name: 'Expo / push notification infrastructure',
    purpose: 'Mobile push delivery where enabled (exp.host endpoints referenced in deployment configuration)',
  },
  {
    name: 'Resend (or configured email API)',
    purpose: 'Transactional email where edge functions send notifications (api.resend.com in CSP)',
  },
] as const;

/** Retention categories — durations are policy placeholders unless confirmed by the company */
export const RETENTION_CATEGORIES = [
  {
    category: 'Account and access records',
    description: 'User profiles, roles, authentication events, and access logs',
    durationPlaceholder: '[duration — confirm with company records retention policy]',
  },
  {
    category: 'Inspection and vigilance records',
    description: 'Checklist responses, scores, photos, branch visits, and related metadata',
    durationPlaceholder: '[duration — confirm; soft-deleted rows may be retained for audit linkage per system design]',
  },
  {
    category: 'Uploaded files and evidence',
    description: 'Photos and documents attached to inspections',
    durationPlaceholder: '[duration — confirm]',
  },
  {
    category: 'Administrative and audit logs',
    description: 'Configuration changes, exports, and security-relevant events where logged',
    durationPlaceholder: '[duration — confirm]',
  },
] as const;
