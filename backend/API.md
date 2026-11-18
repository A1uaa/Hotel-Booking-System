# Koktem Park Hotel REST API

Development base URL: `http://localhost:8000/api/`. Send JSON with `Content-Type: application/json`. Use ISO dates (`YYYY-MM-DD`) and trailing slashes. All money values are in KZT and are returned as decimal strings.

## Endpoints

| Method and path (under /api/) | Access | Success |
|---|---|---|
| GET `health/` | Public | 200, `{"status":"ok"}` |
| GET `auth/csrf/` | Public | 200, sets the CSRF cookie and returns `{"csrf_token":"..."}` |
| POST `auth/register/` | Public + CSRF | 201, account details |
| POST `auth/login/` | Public + CSRF | 200, account details and session cookie |
| POST `auth/logout/` | Session + CSRF | 204, session cleared |
| GET `auth/me/` | Session | 200, current account details |
| GET `rooms/` | Public | 200, array of matching bookable rooms |
| GET `rooms/{id}/` | Public | 200, room details and availability |
| GET `rooms/{id}/availability/` | Public | 200, occupied date ranges for the room calendar |
| GET `bookings/` | Session | 200, array of the current user's bookings |
| POST `bookings/` | Session + CSRF | 201, new booking |
| GET `bookings/{id}/` | Session and owner | 200, booking details |
| POST `bookings/{id}/cancel/` | Session, owner, and CSRF | 200, cancelled booking |
| GET `bookings/{id}/payments/` | Session and owner | 200, array of the booking's payments |
| POST `bookings/{id}/pay/` | Session, owner, CSRF, JSON body | 201 `{payment, booking}`; 402 if the card is declined |
| POST `contact/` | Public + CSRF | 201, message ID |

Hotel administration uses [Django Admin](http://localhost:8000/admin/). A non-superuser hotel administrator needs Staff status and the Admin group's hotel permissions. Registration always assigns Guest and uses Django's password validators and hashing. An existing Django account needs a unique, nonblank email to sign in through the API. Built-in Django Admin continues to use username login.

## Session and CSRF from Angular

1. Use `http://localhost:4200` for Angular and `http://localhost:8000` for Django. Use `localhost` consistently so the browser treats these origins as same-site.
2. Request `GET /api/auth/csrf/` with Angular's `withCredentials: true`. Save the returned `csrf_token` in memory.
3. Set `withCredentials: true` and the `X-CSRFToken` header on each POST. Use `withCredentials: true` on authenticated GET requests too. Angular's built-in XSRF interceptor only adds headers to relative URLs, so set this header explicitly for absolute cross-origin API URLs.
4. Fetch a fresh token immediately after login because Django rotates the CSRF secret. Registering creates an account. Sign in separately to establish a session.
5. Keep the session cookie browser-managed. It is HttpOnly.

Register and login accept the same request shape:

```json
{"email":"guest@example.com","password":"a-long-unique-password"}
```

Account response:

```json
{"id":12,"email":"guest@example.com","role":"Guest"}
```

## Room search

Optional parameters are `check_in` and `check_out` (supply both together), `guests`, `room_type` (numeric ID), `min_price`, and `max_price`. For example:

```http
GET /api/rooms/?check_in=2027-05-10&check_out=2027-05-12&guests=2&room_type=1&min_price=20000&max_price=35000
```

Example room object:

```json
{
  "id": 2,
  "room_number": "102",
  "room_type": {"id": 1, "name": "Standard Room"},
  "description": "Queen room with blackout curtains and a courtyard view.",
  "price_per_night": "28000.00",
  "capacity": 2,
  "amenities": ["Wi-Fi", "Work desk", "Shower", "Tea station"],
  "images": [],
  "available": true
}
```

Each image includes `id`, `image` (URL), and `is_primary`. Without dates, availability reflects the room's operational status. With dates, it also accounts for existing reservations. The list omits unavailable rooms. The detail endpoint can return an unavailable room with `available: false`.

### Availability calendar

`GET /api/rooms/{id}/availability/` returns the upcoming occupied stays of one room so the site can draw a calendar:

```json
{"room": 3, "bookable": true, "booked": [{"check_in": "2027-05-10", "check_out": "2027-05-12"}]}
```

`check_in` is the first occupied night and `check_out` is the day the room is free again, so another guest may check in on that day. Cancelled and finished stays are omitted and no guest details are exposed. `bookable: false` means the room is in maintenance or out of service.

## Bookings and contact

Create a booking:

```json
{"room":2,"check_in":"2027-05-10","check_out":"2027-05-12","guest_count":2}
```

Example response:

```json
{
  "id": 42,
  "room": 2,
  "check_in": "2027-05-10",
  "check_out": "2027-05-12",
  "guest_count": 2,
  "price_per_night": "28000.00",
  "total_price": "56000.00",
  "status": "pending",
  "created_at": "2026-11-10T12:00:00+05:00",
  "updated_at": "2026-11-10T12:00:00+05:00"
}
```

The server sets the owner, status, nightly rate, and total. Dates are validated against the hotel date in `Asia/Almaty`. Checkout is exclusive. Cancellation takes an empty body, accepts pending or confirmed bookings, and returns the cancelled booking on repeated calls.

Contact request and response:

```json
{"name":"Aida","email":"aida@example.com","subject":"Parking","message":"Is overnight parking available?"}
```

```json
{"id":7}
```

## Payments

`POST bookings/{id}/pay/` accepts a JSON body (other content types get 415) with a `method`:

| `method` | Body | Effect |
|---|---|---|
| `card` (default) | `card_holder`, `card_number`, `expiry` (MM/YY), `cvv` | Pays the whole balance now. Booking becomes `confirmed`. |
| `prepayment` | same card fields | Pays 30% of the total now by card (only before any other payment). Booking becomes `confirmed`; the rest is due at the hotel. |
| `cash` | none | Pay at the hotel. Creates a `pending` payment and confirms the booking; staff mark it paid when the money is received. |

The gateway is simulated. `4242 4242 4242 4242` succeeds and `4000 0000 0000 0002` is declined (402, a `failed` payment is recorded). Only the last four card digits are kept; expiry and CVV are discarded. Payment attempts are limited to 20 per minute per user (429 above that), and responses are sent with `Cache-Control: no-store`.

Every booking response includes `paid_amount`, `balance_due`, `prepayment_amount` and `payment_status` (`unpaid`, `partial`, `pay_at_hotel`, `paid`, `refunded`). Payment statuses are `pending`, `paid`, `failed`, `refunded` and `cancelled`. A guest may pay a pending or confirmed booking while a balance remains; paying by card replaces an open pay-at-hotel request. Cancelling a booking refunds its `paid` payments and cancels its `pending` ones. The database also refuses (trigger) paid payments that add up to more than the booking total.

## Errors and concurrency

| Status | Example |
|---|---|
| 400 | `{"check_out":["Check-out must be after check-in."]}` |
| 403 | `{"detail":"Invalid email or password."}`, a missing session, or a failed CSRF check |
| 404 | Unknown room or booking, including a booking owned by another user |
| 409 | `{"detail":"The room is already booked for those dates."}`, unavailable room, duplicate email, or invalid cancellation state |
| 503 | `{"detail":"The database is busy. Please try again."}` |

SQLite serializes writers. Django starts explicit transactions with `BEGIN IMMEDIATE`, so booking creation acquires the write reservation before reading the room and checking overlaps. SQLite triggers enforce the same overlap rule for direct inserts and updates. This uses a database-wide write reservation. Django's `select_for_update()` has no effect on SQLite. Under sustained contention a request may receive 503 even when it targets a different room. For a lost response, check the booking list before resubmitting.

Case-insensitive email uniqueness is enforced by registration inside a transaction. Django's built-in user model still permits out-of-band duplicate emails. API login rejects ambiguous matches. Development uses local HTTP cookies. A public deployment needs HTTPS, secure cookie settings, production Django configuration, and request rate limits.

## Hotel management API

These routes are under `/api/admin/`. They use the same session cookie and CSRF token endpoint as the customer API. Obtain a fresh token after staff login. A Django account must be active, have Staff status, and hold hotel model permissions. The API additionally checks the permissions for each operation. The Angular staff portal is at `http://localhost:4200/admin/login`.

| Method and path | Permission or behavior |
|---|---|
| POST `login/` | Email and password, CSRF, staff eligibility. Returns account and section capabilities. |
| GET `me/` | Verify staff session and return capabilities. |
| GET `dashboard/`, GET `reports/?start=YYYY-MM-DD&end=YYYY-MM-DD` | View rooms, bookings, and payments. |
| GET `rooms/`, `room-types/`, `rooms/{id}/` | View rooms and room types. |
| POST `rooms/`, PATCH or DELETE `rooms/{id}/` | Room read permissions plus add, change, or delete permission respectively. |
| POST `rooms/{id}/photos/` | View room and add room image. Multipart field `image`, JPEG, PNG, or WebP, up to 8 MB and 25 megapixels. |
| PATCH or DELETE `rooms/{id}/photos/{photo_id}/` | View room and change or delete room image. PATCH accepts `{"is_primary":true}`. |
| GET `reservations/`, `reservations/{id}/`, `front-desk/` | View bookings. Reservation list accepts `q`, `status`, and `date`. |
| POST `reservations/{id}/status/` | View and change bookings. Send `{"status":"confirmed"}` or another permitted next state. |
| POST `front-desk/{id}/check-in/`, `front-desk/{id}/check-out/` | View and change bookings. Send an empty object. |
| GET `payments/?q=&status=&method=&date=`, GET `payments/{id}/` | View bookings and payments. Each row has guest, room, booking totals, method, status, note, who recorded it. |
| POST `payments/{id}/status/` | Change payments. `{"status":"paid"\|"refunded"\|"cancelled","note":"..."}`. Allowed: pending → paid or cancelled, paid → refunded. |
| GET `reservations/{id}/payments/`, POST `reservations/{id}/payments/` | View, and add payments to record money received: `{"method":"cash","amount":"20000","note":"Deposit"}`. The amount cannot exceed the balance due. |
| GET `guests/?q=...`, `guests/{id}/` | View bookings and Django users. Guest details include booking history and exclude authentication fields. |

Use `POST /api/auth/logout/` to end the shared Django session. The API returns `403` for denied access or invalid CSRF, `400` for invalid input, `404` for missing records, and `409` for business rule conflicts. A room with any reservation history can be marked `out_of_service` through PATCH. DELETE is reserved for rooms with zero reservation history.

### Reservation transitions

- Pending → confirmed or cancelled.
- Confirmed → checked in or cancelled.
- Checked in → checked out.
- Checked out and cancelled are terminal.

Check-in requires the scheduled arrival date in Almaty, an operational room, and no other guest still checked in. Checkout is allowed on or after the scheduled departure date. The front desk includes overdue checked-in departures. Both action endpoints and general status updates use the same transactional validation.

### Reporting definitions

- Current occupancy counts distinct rooms with a checked-in reservation. Current availability counts operational rooms without a checked-in reservation.
- Reports count reservations whose stays overlap the inclusive date range. Reserved occupancy uses confirmed, checked-in, and checked-out room nights, clipped to the range with checkout excluded. The denominator uses today's room inventory across the selected days. Historical room inventory and maintenance schedules are not recorded.
- Revenue sums paid payments, plus checked-out booking totals for bookings without payment records. Reports date paid amounts by payment creation and completed-booking totals by scheduled checkout. Refunded payments are excluded. This is an operational estimate based on current records, not a financial ledger.
- Popularity counts overlapping, non-cancelled reservations by the room's current type. Report periods are limited to 366 days. Management lists currently return all matching records.
