# Koktem Park Hotel — Hotel Booking and Management System

This repository contains the initial Angular frontend and Django REST API.

- `frontend/` contains the Angular application with routing and SCSS.
- `backend/` contains the Django project, pinned Python dependencies, and local SQLite database. Migrations create `backend/db.sqlite3`.

## Local setup

Use Node.js 24 with npm and Python 3.13. Run the following commands in separate PowerShell terminals from the repository root.

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

Open [http://localhost:8000/api/health/](http://localhost:8000/api/health/) to check that the API returns `{"status": "ok"}`.

### Frontend

```powershell
cd frontend
npm.cmd ci
npm.cmd start
```

Open [http://localhost:4200](http://localhost:4200). Django allows requests from this origin. Run `npm.cmd run build` from `frontend/` to check the production build.

## Hotel database and Django Admin

From `backend/`, apply migrations and load the sample inventory and roles.

```powershell
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py seed_hotel
.\.venv\Scripts\python.exe manage.py createsuperuser
.\.venv\Scripts\python.exe manage.py runserver
```

Sign in at [http://localhost:8000/admin/](http://localhost:8000/admin/) to browse the hotel tables and manage users and groups. To grant hotel management access to a regular account, enable Staff status and assign the Admin group. The Guest group grants no Django Admin permissions.

Room and booking prices and payment amounts are in KZT. Booking dates use the Asia/Almaty time zone. Call `full_clean()` before saving bookings from Python code so the model can validate room capacity and reject past check-in dates for new bookings. Django Admin runs model validation through its forms.

The local SQLite database is `backend/db.sqlite3`. To inspect it through Django, open `manage.py shell` with the virtual environment's Python and query the models from `hotel.models`.

## REST API

See [the backend API reference](backend/API.md) for endpoints, examples, and Angular session and CSRF integration.

## Customer website

The Angular site uses the live Django catalog, sessions, bookings, and contact API. Open `http://localhost:4200` after starting both servers. Keep both development URLs on `localhost`. Django's development CORS and CSRF settings allow Angular on port 4200.

```powershell
# In frontend/
npm.cmd run build
npm.cmd test -- --watch=false

# In backend/
.\.venv\Scripts\python.exe manage.py test
```

Django room photos take precedence when present. The bundled illustrative stock photos are kept in `frontend/public/photos/`, separate from Django media and SQLite. The contact page lists Almaty, Kazakhstan and labels the street address, phone, and email as unpublished.

Photo sources: [Hotel](https://images.unsplash.com/photo-1542314831-068cd1dbfeeb), [exterior](https://images.unsplash.com/photo-1564501049412-61c2a3083791), [standard room](https://images.unsplash.com/photo-1611892440504-42a792e24d32), [deluxe room](https://images.unsplash.com/photo-1618773928121-c32242e63f39), and [suite](https://images.unsplash.com/photo-1590490360182-c33d57733427).

## Ratings and feedback

Anyone can leave feedback on a room, signed in or not and without a booking: 1-5 stars, an optional name and an optional comment. The rooms page shows each room's average rating and review count. Opening a room shows a **Rating** section (average score and the share of each star rating) and a **Feedback** section (the form and the list of reviews). Staff hide or restore a review under **Reviews** in the staff portal; hidden reviews are not shown or counted. Posting is limited to 10 reviews per hour per user or IP (`DEFAULT_THROTTLE_RATES` in `backend/config/settings.py`), and a signed-in user can review a room once.

After pulling these changes run `manage.py migrate` (migration `0005` moves reviews from bookings to rooms; the earlier booking-based reviews are dropped). Run `manage.py test api.test_reviews` and, in `frontend/`, `npm test -- --watch=false` to check them.

## Extras

Guests tick optional extras (breakfast, parking, late check-out, airport transfer) next to the dates on the room page. Prices follow the level of the room: for example breakfast costs more in a Standard Room than in a Deluxe Room, and the Executive Suite includes breakfast, parking and late check-out for free. The estimate on the room page updates as boxes are ticked, and the server works out the final total. Staff change extras and their prices per room type in the Django admin under **Extras**. After pulling these changes run `manage.py migrate` and `manage.py seed_hotel` (the seed adds the extras and never overwrites existing ones).

## Languages

The site is available in Kazakh, Russian and English. The flag buttons in the header switch the language; the choice is remembered in the browser (`localStorage`, key `koktem.language`) and defaults to English. Texts live in `frontend/src/app/core/i18n-en.ts`, `i18n-ru.ts` and `i18n-kk.ts`; templates use the `t` pipe (`{{ 'nav.home' | t }}`) and code uses `translate()`. Room types, descriptions and amenities come from the database in English; the seeded hotel content is translated in `i18n-content.ts`, and anything not listed there is shown as written. Messages returned by the backend and the staff portal stay in English.

## Payments

Guests choose how to pay on `/bookings/:id/payment`:

- **Card** - pays the whole balance now; the booking is confirmed at once.
- **Prepayment** - pays a 30% deposit by card now (`PREPAYMENT_PERCENT` in `backend/api/services.py`); the rest is due at the hotel.
- **Pay at the hotel (cash)** - the room is reserved and a `pending` payment is created; staff mark it received.

The gateway is simulated: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined. Only the last four digits are stored. Staff manage everything under **Payments** in the staff portal (mark cash received, refund, void) and can record money received from a reservation's detail panel. After pulling these changes run `manage.py migrate` (migration `0003` adds the payment method fields and a database trigger that stops paid payments from exceeding the booking total). Run `manage.py test api.test_payments` to check the payment rules.

## Custom staff dashboard

Start Django and Angular as shown above. Visit [Angular staff sign-in](http://localhost:4200/admin/login) to open the custom dashboard. The separate [Django Admin](http://localhost:8000/admin/) can provision staff accounts.

To create the first administrator, run from `backend/`:

```powershell
.\.venv\Scripts\python.exe manage.py createsuperuser
```

Supply a unique, nonblank email and choose a password at the prompt. The Angular sign-in uses the email. For a regular manager, create a Django user, enable **Staff status**, assign the **Admin** group, and grant **Can view user** for guest management. The repeatable `seed_hotel` command grants those permissions to the Admin group when provisioning a new environment. Assign only the model permissions needed for restricted staff accounts.

See the [staff API reference](backend/API.md#hotel-management-api) for routes, permissions, status rules, and report definitions.
