# Artisan (Fastify) — Quickstart

This repository was wired to use Fastify with a small boilerplate to get started quickly.

Getting started

1. Copy env example:

```powershell
copy .env.example .env
```

2. Install dependencies:

```powershell
npm install
```

3. Start in development:

```powershell
npm run dev
```

Or start production mode:

```powershell
npm start
```

API
- GET /api/ -> sanity
- GET /api/users -> list users
- POST /api/users -> create user (JSON body)

Notes
- The project uses Mongoose for MongoDB. Ensure `MONGO_URI` in `.env` points to a running MongoDB.
- Replace the placeholder auth plugin in `src/middlewares/auth.js` with a real JWT/auth implementation for production.

Cloudinary (file uploads)
- **Env vars**: set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. The project also accepts legacy `CLOUD_NAME`, `CLOUD_KEY`, `CLOUD_SECRET` env vars.
- **Install**: `npm install cloudinary` (already included in `package.json`).
- **Behavior**: server-side upload endpoints (KYC, job attachments) upload incoming multipart files to Cloudinary and store the returned secure URLs in the respective models.
- **Serving**: files are served by Cloudinary CDN; to delete an uploaded file use the `public_id` returned by Cloudinary and call `cloudinary.uploader.destroy(public_id)`.

Example `.env` entries:
```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```
