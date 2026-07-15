// =============================================================================
// SkalaUp domain types — mirror supabase/skalaup_schema.sql
// Row* interfaces are the DB shape (snake_case); the exported types are the
// app shape (camelCase). Keep in sync with the SQL file.
// =============================================================================

// ---- Enums -----------------------------------------------------------------
export type UserRole = "freelancer" | "visitor" | "restaurant_manager" | "coordinator";
export type UserStatus = "active" | "inactive" | "pending";
export type MemberType = "member" | "visitor";
export type Transport =
  | "own_car" | "motorcycle" | "public_transit" | "bike" | "walk" | "other";
export type ShiftType = "lunch" | "dinner";
export type CycleStatus = "open" | "closed" | "published";
export type SubmissionStatus = "submitted" | "cancelled";
export type AssignmentStatus = "draft" | "published" | "cancelled";
export type AssignedVia = "coordinator" | "waiting_list" | "swap" | "manager";
export type WaitingStatus = "waiting" | "promoted" | "expired";
export type CheckinMethod = "gps" | "manual";
export type LatenessCategory = "none" | "light" | "moderate" | "severe" | "critical";
export type SwapStatus =
  | "pending_target" | "pending_coordinator" | "approved" | "rejected" | "cancelled";
export type AbsenceType = "no_show_unjustified" | "justified";
export type CoordinatorDecision = "none" | "forgive" | "cancel_remaining";
export type FeedbackStatus = "pending_validation" | "validated" | "rejected";
export type FeedbackCategory =
  | "fundamentos" | "proatividade" | "encantamento" | "extraordinario";
export type FeedbackRequestStatus = "pending" | "completed" | "expired";
export type ScoreEventType =
  | "target_10_shifts" | "swap_accepted" | "meeting" | "online_training"
  | "innovation_video" | "charity_event" | "inperson_training"
  | "feedback_fundamentos" | "feedback_proatividade" | "feedback_encantamento"
  | "feedback_extraordinario" | "late_light" | "late_moderate" | "late_severe"
  | "late_critical" | "swap_requested" | "no_show_unjustified" | "manual_adjustment";
export type NotificationType =
  | "day_start_reminder" | "checkout_reminder" | "checkin_absence" | "third_late"
  | "bonus_loss_warning" | "second_no_show" | "swap_request" | "availability_cancelled"
  | "coverage_deficit" | "availability_reminder" | "schedule_conflict"
  | "weekday_eligibility" | "manager_checkin_checkout" | "feedback_received"
  | "feedback_request" | "schedule_published" | "schedule_assigned" | "schedule_removed"
  | "shift_reminder" | "waitlist_opening" | "birthday" | "inactivity_warning"
  | "profile_inactivated";
export type PayrollEntryType =
  | "shift_pay" | "weekend_bonus" | "late_discount" | "no_show_discount" | "manual_adjustment";

// Canonical point values for the score table (§9.1). Coordinator can override.
export const SCORE_POINTS: Record<ScoreEventType, number> = {
  target_10_shifts: 5,
  swap_accepted: 2,
  meeting: 2,
  online_training: 2,
  innovation_video: 2,
  charity_event: 3,
  inperson_training: 4,
  feedback_fundamentos: 1,
  feedback_proatividade: 2,
  feedback_encantamento: 3,
  feedback_extraordinario: 5,
  late_light: -0.5,
  late_moderate: -2,
  late_severe: -4,
  late_critical: -8,
  swap_requested: -1,
  no_show_unjustified: -5,
  manual_adjustment: 0,
};

// ---- Users -----------------------------------------------------------------
export interface UserRow {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  email: string;
  password?: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  visitor_expires_at: string | null;
  promoted_to_member_at: string | null;
}

export interface User {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  visitorExpiresAt: string | null;
  promotedToMemberAt: string | null;
}

// ---- Restaurants -----------------------------------------------------------
export type NoShowDiscountMode = "highest_shift" | "base_shift" | "custom";

// Shift hours per restaurant/shift (§8.1). Times are "HH:MM" (24h). A meal period
// may have multiple staggered slots; `label` optionally names each (e.g. "Early").
export interface ShiftTemplate {
  shiftType: ShiftType;
  label?: string | null;
  startTime: string;
  endTime: string;
}

export interface RestaurantRow {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  address: string | null;
  cep: string | null;
  cnpj: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  timezone: string;
  base_pay_per_shift: number | null;
  bonus_pay_per_shift: number | null;
  late_discount_amount: number | null;
  no_show_discount_mode: string | null;
  no_show_custom_amount: number | null;
  weekend_bonus_enabled: boolean | null;
  active: boolean;
}

export interface Restaurant {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  address: string | null;
  cep: string | null;
  cnpj: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
  timezone: string;
  // numeric columns arrive from pg as strings (e.g. "60.00") or null when inheriting the global default
  basePayPerShift: string | number | null;
  bonusPayPerShift: string | number | null;
  lateDiscountAmount: string | number | null;
  noShowDiscountMode: NoShowDiscountMode | null;
  noShowCustomAmount: string | number | null;
  weekendBonusEnabled: boolean | null;
  active: boolean;
  shiftTemplates: ShiftTemplate[];
}

// ---- Freelancer profiles ---------------------------------------------------
export interface FreelancerProfileRow {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  member_type: MemberType;
  photo_url: string | null;
  cpf: string | null;
  pix_key: string | null;
  bank_name: string | null;
  birth_date: string | null;
  whatsapp: string | null;
  home_address: string | null;
  home_cep: string | null;
  home_latitude: number | null;
  home_longitude: number | null;
  transport: Transport | null;
  experience: string | null;
  hire_date: string | null;
  current_score: number;
  current_level: number | null;
  notes: string | null;
  public_rating_token: string | null;
}

export interface FreelancerProfile {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  memberType: MemberType;
  photoUrl: string | null;
  cpf: string | null;
  pixKey: string | null;
  bankName: string | null;
  birthDate: string | null;
  whatsapp: string | null;
  homeAddress: string | null;
  homeCep: string | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  transport: Transport | null;
  experience: string | null;
  hireDate: string | null;
  currentScore: number;
  currentLevel: number | null;
  notes: string | null;
  publicRatingToken: string | null;
}

// ---- Availability cycle / submissions --------------------------------------
export interface AvailabilityCycleRow {
  id: string;
  created_at: string;
  updated_at: string;
  reference_month: string;
  opens_at: string;
  closes_at: string;
  status: CycleStatus;
  reopened: boolean;
  published_at: string | null;
}

export interface AvailabilityCycle {
  id: string;
  createdAt: string;
  updatedAt: string;
  referenceMonth: string;
  opensAt: string;
  closesAt: string;
  status: CycleStatus;
  reopened: boolean;
  publishedAt: string | null;
}

export interface AvailabilitySubmissionRow {
  id: string;
  created_at: string;
  cycle_id: string;
  user_id: string;
  date: string;
  shift_type: ShiftType;
  restaurant_id: string;
  preference_rank: number | null;
  status: SubmissionStatus;
  cancelled_at: string | null;
}

export interface AvailabilitySubmission {
  id: string;
  createdAt: string;
  cycleId: string;
  userId: string;
  date: string;
  shiftType: ShiftType;
  restaurantId: string | null; // null = "any restaurant / no preference"
  preferenceRank: number | null;
  status: SubmissionStatus;
  cancelledAt: string | null;
}

// ---- Schedule assignments --------------------------------------------------
export interface ScheduleAssignmentRow {
  id: string;
  created_at: string;
  updated_at: string;
  cycle_id: string | null;
  restaurant_id: string;
  user_id: string;
  date: string;
  shift_type: ShiftType;
  start_time: string;
  end_time: string;
  status: AssignmentStatus;
  is_weekend_mandatory: boolean;
  pay_rate_applied: number | null;
  bonus_applied: boolean;
  assigned_via: AssignedVia;
  created_by: string | null;
  published_at: string | null;
}

export interface ScheduleAssignment {
  id: string;
  createdAt: string;
  updatedAt: string;
  cycleId: string | null;
  restaurantId: string;
  userId: string;
  date: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  status: AssignmentStatus;
  isWeekendMandatory: boolean;
  payRateApplied: number | null;
  bonusApplied: boolean;
  assignedVia: AssignedVia;
  createdBy: string | null;
  publishedAt: string | null;
}

// ---- Score events ----------------------------------------------------------
export interface ScoreEventRow {
  id: string;
  created_at: string;
  user_id: string;
  event_type: ScoreEventType;
  points: number;
  reference_type: string | null;
  reference_id: string | null;
  occurred_on: string;
  month_ref: string;
  created_by: string | null;
  is_voided: boolean;
  notes: string | null;
}

export interface ScoreEvent {
  id: string;
  createdAt: string;
  userId: string;
  eventType: ScoreEventType;
  points: number;
  referenceType: string | null;
  referenceId: string | null;
  occurredOn: string;
  monthRef: string;
  createdBy: string | null;
  isVoided: boolean;
  notes: string | null;
}

// ---- Attendance / check-in (§4, §4.1, §5, §6) ------------------------------
// The joined shape returned by /api/attendance (one row per assignment).
export interface AttendanceShift {
  assignmentId: string;
  userId: string;
  restaurantId: string;
  date: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  status: AssignmentStatus;
  freelancerName: string;
  restaurantName: string;
  checkinAt: string | null;
  checkoutAt: string | null;
  latenessMinutes: number | null;
  latenessCategory: LatenessCategory;
  noShow: boolean;
  editedByCoordinator: boolean;
  absenceId: string | null;
  absenceType: AbsenceType | null;
  occurrenceInMonth: number | null;
  coordinatorDecision: CoordinatorDecision | null;
  justificationText: string | null;
  certificateUrl: string | null;
}

// Extra fields some write endpoints return alongside the refreshed row.
export interface AttendanceMutationResult extends AttendanceShift {
  lateCount?: number;
  discountApplied?: boolean;
  occurrence?: number | null;
  coordinatorPrompted?: boolean;
}

// A 2nd+ unjustified furo awaiting the coordinator's cancel/forgive decision (§5).
export interface PendingAbsence {
  absenceId: string;
  userId: string;
  occurrenceInMonth: number | null;
  createdAt: string;
  freelancerName: string;
  date: string;
  shiftType: ShiftType;
  restaurantName: string;
}

// ---- Shared result type (matches existing lib modules) ---------------------
export type Result<T> = { data: T; error: { message: string } | null };
