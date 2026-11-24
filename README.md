# MentorLagbe — Server

## Project name

**MentorLagbe API** — the Express + MongoDB backend for the MentorLagbe tuition marketplace.

## Purpose

This API stores and serves tuition listings, applications, users, bookmarks, and payment records for the MentorLagbe Next.js client. It also issues role-aware JWTs, enforces Student/Tutor/Admin access with middleware, and handles Stripe Checkout sessions.

## Live URL

> **TODO before submission:** replace with the deployed backend URL.

- Backend API: `https://tution-lagbe-server.vercel.app/`
- Local development: `http://localhost:5000`
- Frontend client: `https://<your-deployed-client-url>`

##  credentials



| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@gmail.com` | `<12345678>` |
| Tutor | `<tutor@gmail.com>` | `<12345678>` |
| Student | `<student@gmail.com>` | `<12345678>` |

The Admin role is not self-registerable. Set a user's `role` field to `admin` in MongoDB (or update it from the admin users screen after signing in) to create the demo admin.

## Key features

- Express 5 REST API with CORS and JSON body parsing.
- MongoDB collections for `tuitions`, `applications`, `user`, and `payments`.
- JWT issuance (`POST /jwt`) and middleware for authenticated requests.
- Role middleware: `verifyStudent`, `verifyTutor`, and `verifyAdmin`.
- Public tuition browsing with search and filter support.
- Tutor CRUD for tuition posts; new posts are pending until admin approval.
- Admin endpoints for overview stats, user role management, tuition moderation, and transactions.
- Student applications with duplicate prevention, status updates, and cancellation.
- Tutor applicant review with accept/reject actions.
- Shared user profile and bookmark endpoints.
- Stripe Checkout session creation and payment verification; successful payments upgrade the user to `pro` and store a transaction record.
- Free-plan limits and Pro-plan unlocks for posting/bookmarking.

## Main API endpoints

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/` | Public | Health check |
| `POST` | `/jwt` | Public | Issue JWT for a known user email |
| `GET` | `/tuitions` | Public | List/filter approved tuitions |
| `GET` | `/tuitions/subjects` | Public | List available subjects |
| `GET` | `/tuitions/:id` | Public | Get one tuition |
| `POST` | `/tuitions` | Tutor | Create a tuition (pending approval) |
| `PATCH` | `/tuitions/:id` | Tutor | Update own tuition |
| `DELETE` | `/tuitions/:id` | Tutor | Delete own tuition |
| `POST` | `/applications` | Student | Apply to a tuition |
| `GET` | `/applications/:email` | Auth | Student applications |
| `PATCH` | `/applications/:id/status` | Tutor | Accept/reject an application |
| `DELETE` | `/applications/:id` | Student | Cancel an application |
| `GET` | `/users/profile/:email` | Auth | Get profile and bookmarks |
| `PATCH` | `/users/profile/:email` | Auth | Update profile |
| `POST` | `/users/bookmarks/toggle` | Auth | Toggle a bookmark |
| `GET` | `/admin/overview` | Admin | Dashboard counts |
| `GET` | `/admin/users` | Admin | List users |
| `PATCH` | `/admin/users/:id/role` | Admin | Change a user's role |
| `GET` | `/admin/tuitions` | Admin | List pending/approved tuitions |
| `PATCH` | `/admin/tuitions/:id` | Admin | Approve/reject a tuition |
| `GET` | `/admin/transactions` | Admin | List payment records |
| `POST` | `/payments/create-checkout-session` | Auth | Create a Stripe Checkout session |
| `POST` | `/payments/verify-session` | Public | Verify payment and upgrade plan |

## Tech stack

- Node.js with Express 5 (ES modules)
- MongoDB with the official `mongodb` driver
- JSON Web Tokens for authorization
- Stripe Checkout for payments
- dotenv for environment variables

## npm packages used

`express`, `cors`, `dotenv`, `mongodb`, `jsonwebtoken`, `stripe`

## Getting started

Use **npm** (the repository includes `package-lock.json`).

```bash
npm install
```

Create a local `.env` file (it is gitignored):

```env
MONGO_USERNAME=<your-mongodb-username>
MONGO_PASSWORD=<your-mongodb-password>
STRIPE_SECRET_KEY=<your-stripe-secret-key>
CLIENT_URL=http://localhost:3000
JWT_ACCESS_SECRET=<your-jwt-signing-secret>
```

The server currently listens on port `5000`. Start it with:

```bash
node index.js
```

Then start the client from `../tution-lagbe` with `npm run dev` and set `NEXT_PUBLIC_API_URL=http://localhost:5000` in the client `.env`.

## Repository

Server source: `https://github.com/Razdee01/tution-lagbe-server.git`
