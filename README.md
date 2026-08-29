# File Upload Backend

This backend provides a full file-upload workflow using:

- JWT auth stored in an `accessToken` cookie
- Presigned uploads to Amazon S3
- MongoDB for file metadata
- Public and private file access
- Share links for external viewing/downloading
- Per-user 5 GB storage quota
- Batch upload support with one presigned URL per file

## What this service does

The upload flow is split into two parts:

1. Generate a presigned S3 upload URL for the file.
2. Store the uploaded file metadata in MongoDB after the client finishes the S3 upload.

This keeps large file transfers off the API server while still letting the backend control access, metadata, and sharing.

The backend also tracks how much storage each user has used so it can return the remaining quota before issuing new presigned URLs.

## Upload lifecycle

### 1. Request a presigned upload URL

The client sends the original file name and content type to:

`POST /api/uploads/presign`

The backend:

- validates the payload
- reads the logged-in user from the `accessToken` cookie
- creates a unique S3 key in this format:

`uploads/<userId>/<timestamp>-<uuid>-<sanitized-file-name>`

- returns:
  - `fileKey`
  - `s3Key` as an alias of `fileKey`
  - `uploadUrl`
  - `fileUrl`
  - `expiresIn`

Before returning the URL, the backend checks the user's current storage usage and rejects the request if the new file would push them over the 5 GB limit.

### 1b. Request batch presigned upload URLs

For multiple files, the client sends an array of file metadata to:

`POST /api/uploads/presign-batch`

The backend:

- validates every file entry
- sums the total batch size
- checks the user's remaining quota
- returns one presigned S3 upload URL per file

Response includes:

- `uploads[]` with `fileName`, `size`, `s3Key`, `uploadUrl`, `fileUrl`, and `expiresIn`
- `usedStorageBytes`
- `remainingStorageBytes`
- `batchSizeBytes`

### 2. Upload the file directly to S3

The client performs a `PUT` request to the returned `uploadUrl`.

Important details:

- the request body must be the raw file bytes
- the `Content-Type` should match the one used during presign
- this request goes directly to S3, not to the API server

### 3. Save file metadata in MongoDB

After the S3 upload succeeds, the client calls:

`POST /api/uploads`

This stores the metadata record in MongoDB.

The backend expects:

- `file`: the display name or original file name
- `s3Key`: the exact S3 object key returned by the presign endpoint
- optional metadata like description, date, status, mimeType, and size

For batch uploads, the client can send multiple records to:

`POST /api/uploads/batch`

Each uploaded file gets its own MongoDB record, share token, and share link.

## Use cases

This backend is useful for:

- profile or asset uploads
- document management
- image or media storage
- shareable file links
- private file storage per user

## Authentication and access rules

Authentication uses an HTTP-only cookie named `accessToken`.

The auth flow is:

- `auth` middleware: requires a valid cookie
- `optionalAuth` middleware: allows anonymous access, but attaches the user if the cookie exists
- `authorize("user")`: restricts access to the user role

Public and private access behavior:

- public files can be viewed without logging in
- private files require the owner to be logged in
- deletion and metadata updates require the owner or an authorized user
- admin access is supported in some controller checks

## API endpoints

Base path: `/api/uploads`

### `POST /presign`

Generate a presigned S3 upload URL.

Auth: required

Request body:

```json
{
  "fileName": "example.png",
  "contentType": "image/png",
  "size": 1915617
}
```

Response:

```json
{
  "message": "Presigned upload URL generated successfully",
  "success": true,
  "fileKey": "uploads/<userId>/<timestamp>-<uuid>-example.png",
  "s3Key": "uploads/<userId>/<timestamp>-<uuid>-example.png",
  "uploadUrl": "https://...",
  "fileUrl": "https://...",
  "expiresIn": 900,
  "maxFileSizeBytes": 5368709120,
  "usedStorageBytes": 1915617,
  "remainingStorageBytes": 5366793503
}
```

### `POST /presign-batch`

Generate presigned S3 upload URLs for multiple files.

Auth: required

Request body:

```json
{
  "files": [
    {
      "fileName": "photo.webp",
      "contentType": "image/webp",
      "size": 1048576
    },
    {
      "fileName": "video.mp4",
      "contentType": "video/mp4",
      "size": 7340032
    }
  ]
}
```

Response:

```json
{
  "message": "Batch presigned upload URLs generated successfully",
  "success": true,
  "maxFileSizeBytes": 5368709120,
  "usedStorageBytes": 1048576,
  "remainingStorageBytes": 5367650544,
  "batchSizeBytes": 8388608,
  "uploads": [
    {
      "fileName": "photo.webp",
      "contentType": "image/webp",
      "size": 1048576,
      "s3Key": "uploads/<userId>/...",
      "uploadUrl": "https://...",
      "fileUrl": "https://...",
      "expiresIn": 900
    },
    {
      "fileName": "video.mp4",
      "contentType": "video/mp4",
      "size": 7340032,
      "s3Key": "uploads/<userId>/...",
      "uploadUrl": "https://...",
      "fileUrl": "https://...",
      "expiresIn": 900
    }
  ]
}
```

### `POST /`

Create the MongoDB upload record after the S3 upload is complete.

Auth: required

Request body:

```json
{
  "file": "example.png",
  "s3Key": "uploads/<userId>/<timestamp>-<uuid>-example.png",
  "description": "Optional description",
  "date": "2026-08-25T07:10:33.384Z",
  "status": "public",
  "originalName": "example.png",
  "mimeType": "image/png",
  "size": 1915617
}
```

### `POST /batch`

Create multiple MongoDB upload records after the batch S3 uploads are complete.

Auth: required

Request body:

```json
{
  "uploads": [
    {
      "file": "photo.webp",
      "s3Key": "uploads/<userId>/...",
      "description": "Optional description",
      "date": "2026-08-25T07:10:33.384Z",
      "status": "public",
      "originalName": "photo.webp",
      "mimeType": "image/webp",
      "size": 1048576
    }
  ]
}
```

Response includes the saved upload records:

```json
{
  "message": "Batch uploads created successfully",
  "success": true,
  "uploads": []
}
```

Response includes the saved upload record:

```json
{
  "message": "Upload created successfully",
  "success": true,
  "upload": {
    "id": "...",
    "user": "...",
    "file": "example.png",
    "s3Key": "uploads/<userId>/<timestamp>-<uuid>-example.png",
    "description": "Optional description",
    "date": "...",
    "status": "public",
    "shareLink": "...",
    "shareToken": "...",
    "originalName": "example.png",
    "mimeType": "image/png",
    "size": 1915617,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### `GET /`

List uploads for the current user.

Auth: required

Role: `user` via route guard

### `GET /quota`

Return the authenticated user's upload quota usage.

Auth: required

Response includes:

- `maxFileSizeBytes`
- `usedStorageBytes`
- `remainingStorageBytes`

### `GET /share/:token`

Resolve a share token into metadata plus a presigned download URL.

Auth: not required

This is the public sharing entry point.

Response includes:

- upload metadata
- `downloadUrl`

### `GET /:id`

Fetch metadata for a single upload.

Auth: optional

Behavior:

- public upload: metadata is returned without login
- private upload: owner login is required

### `GET /:id/download`

Stream the file contents from S3.

Auth: optional

Behavior:

- public upload: accessible without login
- private upload: owner login is required

### `PATCH /:id`

Update an upload record.

Auth: required

This can update fields such as:

- `file`
- `s3Key`
- `description`
- `date`
- `status`
- `originalName`
- `mimeType`
- `size`

If the S3 key changes, the old S3 object is deleted.

### `DELETE /:id`

Delete an upload record and its S3 object.

Auth: required

## Data model

Each upload record stores:

- `user`
- `file`
- `s3Key`
- `description`
- `date`
- `status`
- `shareLink`
- `shareToken`
- `originalName`
- `mimeType`
- `size`
- timestamps

## S3 naming rules

Uploaded files are stored under:

`uploads/<userId>/...`

The file name is sanitized before key generation:

- converted to lowercase
- spaces become hyphens
- unsupported characters are removed
- repeated hyphens are collapsed

Example:

`ChatGPT Image Aug 20, 2026, 06_29_38 PM.png`

can become something like:

`uploads/<userId>/1787641831906-96f96b69-5e3d-45a5-9ec1-5ccb0e2f8ca5-chatgpt-image-aug-20-2026-06_29_38-pm.png`

## Environment variables

Required:

- `MONGO_URI`
- `JWT_SECRET`
- `AWS_REGION`
- `AWS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional:

- `PORT` default: `5000`
- `CORS_ORIGIN` default: `http://localhost:3000`
- `JWT_EXPIRES_IN`
- `S3_PRESIGN_EXPIRES_IN` default: `900`
- `S3_DOWNLOAD_EXPIRES_IN` default: `900`
- `NODE_ENV`

## Run locally

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Build production output:

```bash
npm run build
```

Start the compiled server:

```bash
npm start
```

## Typical client flow

1. Log in and receive the `accessToken` cookie.
2. Call `POST /api/uploads/presign` with the file name and content type.
3. Upload the file directly to S3 using the returned `uploadUrl`.
4. Call `POST /api/uploads` with the same `s3Key` and any file metadata.
5. Use `GET /api/uploads`, `GET /api/uploads/:id`, or `GET /api/uploads/share/:token` to read it later.

For multiple files:

1. Call `POST /api/uploads/presign-batch` with all file metadata.
2. Upload each file directly to S3 using its own `uploadUrl`.
3. Call `POST /api/uploads/batch` with the completed upload metadata.

## Notes

- `file` is the display/original file name.
- `s3Key` is the actual S3 object key and should be treated as the source of truth for storage operations.
- Share links are generated from the backend host and the upload share token.
- The API server never proxies the initial upload file bytes through Express; the file goes straight to S3.
- The 5 GB limit is enforced per user across all uploads, and the quota endpoint can be used to show remaining storage in the UI.
