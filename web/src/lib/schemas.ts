/**
 * Shared zod schemas for every admin-side form.
 *
 * Keeping these in one place means:
 *   - A single source of truth for what's valid on each table.
 *   - Forms (react-hook-form) and server actions can both share the same
 *     parsing logic if/when we add server-side validation.
 *   - Inferring the TS types from the schema (`z.infer<typeof X>`) keeps the
 *     form types and the runtime checks aligned automatically.
 */

import { z } from 'zod';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Accept "" / undefined as "no value", strip surrounding whitespace. */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

/**
 * Number that may arrive from an <input type="number" /> as a string. Returns
 * undefined when the field is blank.
 */
const optionalNumber = (opts: { min?: number; max?: number; int?: boolean } = {}) =>
  z.preprocess(
    (v) => {
      if (v === '' || v === null || v === undefined) return undefined;
      if (typeof v === 'string') {
        const n = Number(v);
        return Number.isNaN(n) ? v : n;
      }
      return v;
    },
    (() => {
      let s: z.ZodTypeAny = opts.int ? z.number().int() : z.number();
      if (opts.min !== undefined) s = (s as z.ZodNumber).min(opts.min);
      if (opts.max !== undefined) s = (s as z.ZodNumber).max(opts.max);
      return s.optional();
    })(),
  );

// ── branches ────────────────────────────────────────────────────────────────

export const branchSchema = z
  .object({
    name: z
      .string({ required_error: 'Branch name is required' })
      .trim()
      .min(2, 'Branch name must be at least 2 characters')
      .max(120, 'Branch name is too long'),
    location: optionalString,
    city: optionalString,
    region: optionalString,
    incharge_name: optionalString,
    incharge_phone: optionalString,
    latitude: optionalNumber({ min: -90, max: 90 }),
    longitude: optionalNumber({ min: -180, max: 180 }),
    geofence_radius: z.preprocess(
      (v) => {
        if (v === '' || v === null || v === undefined) return 200;
        if (typeof v === 'string') {
          const n = Number(v);
          return Number.isNaN(n) ? v : n;
        }
        return v;
      },
      z
        .number({ invalid_type_error: 'Radius must be a number' })
        .int('Radius must be a whole number')
        .min(50, 'Radius must be at least 50 m')
        .max(5000, 'Radius must be at most 5,000 m'),
    ),
  })
  // Require lat+lng together — half a coordinate is worse than none.
  .superRefine((data, ctx) => {
    const hasLat = data.latitude !== undefined && data.latitude !== null;
    const hasLng = data.longitude !== undefined && data.longitude !== null;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide both latitude and longitude, or leave both blank',
        path: [hasLat ? 'longitude' : 'latitude'],
      });
    }
    if (!hasLat || !hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'GPS coordinates are required so officers can verify store location. Paste a full Google Maps address or enter latitude and longitude.',
        path: ['latitude'],
      });
    }
  });

export type BranchFormValues = z.infer<typeof branchSchema>;

// ── users ───────────────────────────────────────────────────────────────────

export const userSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  phone: optionalString,
  role: z.enum(['officer', 'management', 'admin'], {
    required_error: 'Pick a role',
  }),
  is_active: z.boolean().default(true),
});

export type UserFormValues = z.infer<typeof userSchema>;

// ── checklist items ────────────────────────────────────────────────────────

export const checklistItemSchema = z.object({
  section: z.string().trim().min(1, 'Section is required'),
  item_text: z.string().trim().min(3, 'Item text must be at least 3 characters'),
  risk_level: z.enum(['RED', 'YELLOW', 'GREEN']).default('GREEN'),
  statutory_act: optionalString,
  trigger_on_no: z.boolean().default(false),
  requires_photo: z.boolean().default(false),
  min_remark_chars: z.coerce.number().int().min(0).max(500).default(0),
});

export type ChecklistItemFormValues = z.infer<typeof checklistItemSchema>;
