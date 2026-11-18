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
