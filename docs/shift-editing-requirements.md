# Requirements — Manager Shift Editing on the Scheduling Page

**Feature:** Allow **restaurant managers** to fill shifts on the Scheduling page
("Montagem de Escala"). Selecting an empty/partly-filled cell shows a list of **only
the team members registered to that restaurant who are available for that exact slot**;
picking a name assigns them, and assigned names stack **sequentially** inside the cell.

Status: Draft for review · Owner: TBD · Last updated: 2026-06-19

---

## 1. Context — what already exists

The coordinator/administrator "Schedule Builder" already implements ~90% of this flow.
Reusing it (rather than building anew) is the recommended approach.

| Capability | Where it lives today |
|---|---|
| Weekly grid (Shift → Restaurant × 7 days) | `GET /api/scheduling/week` ([scheduling.js](../server/src/routes/scheduling.js)) → [SchedulingPage.tsx](../src/pages/SchedulingPage.tsx) |
| Per-cell candidate list (registered + available, ranked by score) | `GET /api/scheduling/board` + `GET /api/availability/submissions/slot` ([availability.js](../server/src/routes/availability.js)) |
| Cell popover: list candidates, assign, remove, set required | `ScheduleCell` in [SchedulingPage.tsx](../src/pages/SchedulingPage.tsx) |
| Assign a person to a slot (with conflict rule) | `POST /api/assignments` ([assignments.js](../server/src/routes/assignments.js)) |
| Sequential names in a cell | `cell.assigned[]` rendered top-down, score-desc |
| Manager ↔ restaurant link | `public.manager_assignments` (already seeded for the demo manager) |

**Key definitions, grounded in the schema:**
- **"Registered to that restaurant + available for the slot"** = rows in
  `public.availability_submissions` with `status='submitted'` matching
  `(cycle_id, date, shift_type, restaurant_id)`. (A freelancer "registers" to a
  restaurant by submitting availability for it.)
- **"Assigned"** = rows in `public.schedule_assignments` with `status <> 'cancelled'`.
- A manager's restaurants = `manager_assignments` where `manager_user_id = me`.

**The core gaps** this feature must close:
1. Managers currently **cannot reach** the scheduling API — the whole `scheduling.js`
   router and the write routes in `assignments.js` are gated `requireRole("coordinator","administrator")`.
2. The `/scheduling` nav item is `roles: COORD` only ([AppSidebar.tsx:40](../src/components/layout/AppSidebar.tsx)) — managers don't see the page.
3. Nothing **scopes the board to a manager's own restaurant(s)** — a manager must
   never see or edit other restaurants.
4. `assigned_via` enum has no `'manager'` value to attribute manager-made assignments.

---

## 2. Scope

**In scope**
- Restaurant managers viewing the scheduling grid **restricted to their assigned restaurant(s)**.
- Cell popover for managers: candidate list (registered + available for that slot at that
  restaurant), assign, and remove/unassign their own draft assignments.
- Sequential display of assigned members within a cell.
- Server-side enforcement that a manager can only act on their own restaurant(s).

**Out of scope (this iteration — confirm in §11)**
- Managers editing **demand/required counts** (`setOverride`) — keep coordinator-only unless decided otherwise.
- Managers **publishing** the cycle — see Decision D2.
- Autopilot/autofill for managers (the button was removed from the page).
- Creating availability cycles or editing freelancer registration.

---

## 3. Roles & permissions

| Action | freelancer | restaurant_manager | coordinator | administrator |
|---|:--:|:--:|:--:|:--:|
| View scheduling grid | ✖ | ✅ (own restaurants only) | ✅ (all) | ✅ (all) |
| See candidate list for a cell | ✖ | ✅ (own restaurant) | ✅ | ✅ |
| Assign a member to a slot | ✖ | ✅ (own restaurant, open cycle) | ✅ | ✅ |
| Remove a **draft** assignment | ✖ | ✅ (own restaurant, open cycle) | ✅ | ✅ |
| Set required/demand | ✖ | ✖ (D1) | ✅ | ✅ |
| Publish cycle | ✖ | ✖ (D2) | ✅ | ✅ |

---

## 4. Functional requirements

### Access & navigation
- **FR-1** The `/scheduling` route and its sidebar nav item must be visible to
  `restaurant_manager` in addition to coordinator/administrator.
- **FR-2** Direct navigation to `/scheduling` by an unauthorized role (freelancer/visitor)
  must be blocked client-side and server-side (no data leakage).

### Restaurant scoping
- **FR-3** For a manager, the grid must show **only restaurants linked via
  `manager_assignments`**. If a manager has one restaurant, default the filter to it; if
  several, the "Cliente" filter lists only those restaurants (no "Todos os clientes"
  option that would reveal others).
- **FR-4** The server must derive the allowed restaurant set from the authenticated
  manager's `manager_assignments` and **ignore/ә reject** any `restaurantId` outside it
  (do not trust the client-supplied filter).
- **FR-5** A manager with **zero** linked restaurants sees an empty-state message and no grid.

### Cell selection & candidate list
- **FR-6** Selecting a cell (restaurant × shift × day) opens a popover listing candidates =
  members with a **submitted availability** for that exact `(cycle, date, shift_type, restaurant)`.
- **FR-7** The candidate list must **exclude** members already assigned to that same cell.
- **FR-8** Candidates are **ordered by score descending**, then name (existing behavior; this
  is the "ordenados por pontuação" waiting-list order).
- **FR-9** Each candidate row shows at minimum: name, score, star level; and a **conflict
  flag** when that member is already booked in the same `date + shift` at another restaurant
  (§3.3). Assigning a conflicted member must be prevented (see FR-13).
- **FR-10** Empty states must be explicit: "no availability cycle", "no candidates for this slot".

### Assignment
- **FR-11** Selecting a candidate creates a `schedule_assignments` row with `status='draft'`,
  the slot's resolved `start_time/end_time`, `is_weekend_mandatory` computed by rule, and
  `assigned_via='manager'`, `created_by = manager.id`.
- **FR-12** After assigning, the candidate disappears from the list and the name appears in
  the cell immediately (optimistic or refetch — existing `onChanged()` reload is acceptable).
- **FR-13 (Conflict rule §3.3)** A member already assigned to the same `date + shift` (any
  restaurant) must not be assignable; the API returns `409 schedule_conflict` and the UI
  shows a clear message. Enforced by both the explicit check and the
  `unique (user_id, date, shift_type)` constraint.
- **FR-14 (Capacity)** The cell shows `assignedCount / required` and a deficit indicator.
  Assigning above `required` is **allowed but flagged** (over-staffed) — OR blocked — see
  Decision D3.
- **FR-15 (Eligibility §8.3)** The non-blocking weekday-eligibility warning already returned
  by `POST /api/assignments` must surface to the manager as a toast (do not block).

### Sequential display
- **FR-16** Assigned members render **stacked in the cell in score-desc order**, one row each
  (first name + score), matching the existing coordinator rendering.
- **FR-17** The cell badge reflects live counts (`n/required`); deficit/over-staffed styling
  updates after each change.

### Removal / un-assign
- **FR-18** A manager can remove a **draft** assignment they are permitted to manage
  (own restaurant, open cycle) via the cell popover — reusing `DELETE /api/assignments/:id`
  (draft-only) or `PUT /api/assignments/:id/cancel`.
- **FR-19** Removing a member returns them to the candidate list (if still available).

### Cycle-status gating
- **FR-20** Editing (assign/remove) is allowed **only when an availability cycle exists and
  its status is not `published`** (existing `canEdit = !!cycle && !published`). When
  published or absent, the grid is read-only with an explanatory banner.

---

## 5. Business rules (must be preserved)
- **BR-1 Conflict (§3.3):** one member per `date + shift` across all restaurants.
- **BR-2 Weekend-mandatory (§7.1/§8.2):** weekend slots flagged `is_weekend_mandatory`
  (already computed by `isWeekendMandatory`).
- **BR-3 Weekday eligibility (§8.3):** warn-only when assigning a weekday shift to a member
  lacking the prior weekend's 4 mandatory shifts.
- **BR-4 Draft vs published:** manager edits only ever produce/modify **draft** rows;
  publishing is a separate, gated action.
- **BR-5 Availability is the gate:** a member with no submitted availability for the
  slot/restaurant is never a candidate, even if otherwise free.

---

## 6. Data model changes
- **DM-1** Extend the `assigned_via` check constraint on `public.schedule_assignments` to
  include `'manager'`:
  `('coordinator','waiting_list','swap','manager')`.
  ⚠️ This is a **constraint change**, not an additive column — the migration must
  `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...` (idempotently). Add it to
  [skalaup_schema.sql](../supabase/skalaup_schema.sql) and **run `npm run migrate` on deploy**
  (this project has repeatedly broken from un-run migrations — see deploy checklist §13).
- **DM-2** No new tables required; `manager_assignments` already provides scoping.
- **DM-3 (optional)** Consider an index on
  `availability_submissions (cycle_id, restaurant_id, date, shift_type, status)` and on
  `schedule_assignments (restaurant_id, date, shift_type, status)` if the grid query is slow
  at scale.

---

## 7. API changes
- **API-1** Relax the router-level gate in [scheduling.js](../server/src/routes/scheduling.js)
  so **read** endpoints (`/week`, `/board`) allow `restaurant_manager`, while demand writes
  (`/demand`, `/overrides`) stay coordinator/admin (D1). Add per-request restaurant-scope
  enforcement (FR-4).
- **API-2** Allow `restaurant_manager` on `POST /api/assignments`, `DELETE /api/assignments/:id`,
  `PUT /api/assignments/:id/cancel` — but only when the target `restaurantId` ∈ the manager's
  `manager_assignments` **and** the row's cycle is not published. Add a reusable
  `requireRestaurantAccess(req, restaurantId)` helper.
- **API-3** `GET /api/scheduling/week` and `/board` must, for a manager, intersect the
  requested restaurant scope with the manager's allowed set (reject or silently restrict).
- **API-4** All new authorization failures return JSON (`403`/`409`) — never let a query
  error crash the process (wrap handlers in try/catch; the login crash incident showed why).

---

## 8. Frontend changes ([SchedulingPage.tsx](../src/pages/SchedulingPage.tsx))
- **FE-1** Add `/scheduling` to manager nav ([AppSidebar.tsx](../src/components/layout/AppSidebar.tsx)).
- **FE-2** Load the restaurant filter from the manager's own restaurants; hide "Todos os
  clientes" for single-restaurant managers (or scope it to their set).
- **FE-3** `canEdit` must also respect role (manager allowed) and remain false when published.
- **FE-4** Reuse `ScheduleCell` candidate popover unchanged; ensure it works when the board is
  pre-scoped to one restaurant.
- **FE-5** Localize all new strings in `pt-BR` and `en` ([locales](../src/i18n/locales)).
- **FE-6** Error toasts for `schedule_conflict`, over-capacity, eligibility warning, and
  read-only/published states.

---

## 9. Non-functional requirements
- **NFR-1 Security:** server is the source of truth for scoping; a manager calling the API
  with another restaurant's id gets `403` (verify with an automated test).
- **NFR-2 Concurrency:** two managers/coordinators assigning the last slot simultaneously —
  the `unique (user_id, date, shift_type)` constraint + `409` handling must prevent duplicates
  without crashing.
- **NFR-3 Performance:** grid for a manager's restaurants for a week should load in the same
  few aggregated queries already used by `/week` (no per-cell N+1).
- **NFR-4 i18n:** PT-BR is primary; EN parity required.
- **NFR-5 Auditability:** `created_by` and `assigned_via='manager'` record who assigned.

---

## 10. Edge cases & error handling
| # | Case | Expected behavior |
|---|---|---|
| E1 | No availability cycle for the month | Read-only grid + "create cycle" hint (coordinator only); managers see read-only notice |
| E2 | Cycle published | Whole grid read-only for managers; assign/remove disabled |
| E3 | No candidates for a slot | Popover shows "no candidates"; no assign button |
| E4 | Candidate becomes conflicted between list-load and click | `409` from API; toast; refresh list |
| E5 | Required = 0 but manager wants to add | Honor D3 (allow-flagged or block) |
| E6 | Manager removed from a restaurant mid-session | Next API call returns `403`; UI refetches scope |
| E7 | Member cancels availability after being a candidate | They drop from list on next load; existing assignment unaffected until removed |
| E8 | Over-capacity assignment | Per D3 |

---

## 11. Decisions to confirm (product)
- **D1** Can managers edit **required/demand** counts for their restaurant, or is that
  coordinator-only? *(Default assumption: coordinator-only.)*
- **D2** Can managers **publish** their restaurant's schedule, or only coordinators?
  *(Default assumption: coordinators publish; managers only fill drafts.)*
- **D3** Assigning **beyond `required`**: allow with an "over-staffed" flag, or hard-block?
  *(Default assumption: allow + flag.)*
- **D4** Multi-restaurant managers: one combined grid filtered by client, or a forced
  single-restaurant selector? *(Default assumption: filter listing only their restaurants.)*
- **D5** Should managers see **other restaurants'** assignments read-only (for conflict
  visibility), or nothing outside their own? *(Default assumption: only their own; conflicts
  surfaced via the API conflict flag.)*

---

## 12. Acceptance criteria (Gherkin)
```
Scenario: Manager fills an empty slot
  Given I am signed in as a restaurant_manager linked to "Restaurante Bueno"
  And an availability cycle for the month is "open"
  When I open the Almoço cell for Restaurante Bueno on Fri 19
  Then I see only members with submitted availability for that slot, ordered by score
  And members already assigned to that cell are not listed
  When I select the top candidate
  Then they are assigned as a draft via "manager"
  And their name appears in the cell and the count increases by one
  And they disappear from the candidate list

Scenario: Conflict is prevented
  Given a candidate is already assigned to the same date and shift elsewhere
  When I try to assign them
  Then I get a clear conflict message and no assignment is created

Scenario: Scope is enforced server-side
  When I (manager of Bueno) call the assignment API with Restaurante Centro's id
  Then I receive 403 and no row is created

Scenario: Published cycle is read-only
  Given the cycle status is "published"
  Then I cannot assign or remove anyone and the grid is read-only
```

---

## 13. Implementation & deploy checklist
1. Schema: add `'manager'` to `assigned_via` check constraint (DM-1) in `skalaup_schema.sql`.
2. Backend: scope helper + relax role gates (API-1..4) with try/catch on every handler.
3. Frontend: nav + role-aware `canEdit` + scoped restaurant filter (FE-1..6).
4. i18n: PT-BR + EN strings.
5. Tests: scope-enforcement (403), conflict (409), happy-path assign/remove, published read-only.
6. **Deploy (do not skip the migration):**
   ```bash
   cd /var/www/pro-skalaup
   npm run build
   cd server && npm run migrate   # applies DM-1
   pm2 restart skalaup-api
   ```
