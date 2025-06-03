# AI Receipt Processor

A Node.js + Express + SQLite app that extracts structured data from PDF receipts using Google Gemini (Vertex AI). Uploaded PDFs go to `temp/`, then, after validation and AI processing, move to `uploads/<year>/<category>/`. Metadata is stored in SQLite.

## Prerequisites
- Node.js v16+
- npm
- Google Cloud account with Vertex AI (Gemini) enabled
- SQLite3 (included via npm)

## Setup

1. **Clone & Install**
   ```bash
   git clone https://github.com/shivkinga53/receipt-ocr-app.git
   cd receipt-ocr-app
   npm install
   ```

2. **Obtain Gemini API Key**
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Create/select a project.
   - Enable **Vertex AI** (Gemini) API under **APIs & Services → Library**.
   - Go to **APIs & Services → Credentials** and **Create Credentials → API Key**.
   - Copy your API key.

3. **Configure `.env`**
   Create a `.env` file in the project root:
   ```
   GEMINI_API_KEY=YOUR_KEY_HERE
   PORT=3000
   ```

4. **Database Initialization**
   On first run, `database.js` creates `receipts.db` (with tables `receipt_file` and `receipt`) and triggers.

## Folder Structure
```
receipt-ocr-app/
├── public/
│   ├── index.html    # Bootstrap UI
│   └── script.js     # Front-end logic
├── temp/             # (auto-cleared) incoming PDFs
├── uploads/          # (auto-cleared) processed PDFs by year/category
│   └── 2018/transportation/bart_20180908_004.pdf
├── .env
├── database.js       # SQLite setup & helpers
├── server.js         # Express server & API routes
├── receipts.db       # (auto-created) SQLite DB
├── package.json
└── README.md         # this file
```

## How It Works

1. **Upload** (`POST /api/upload`)
   - Multer saves to `temp/<sanitized_name>.pdf`.
   - Inserts/updates `receipt_file` (`is_valid=false`, `is_processed=false`).

2. **Validate** (`POST /api/validate/:fileId`)
   - Checks existence in `temp/`.
   - Sets `is_valid=true` or logs an `invalid_reason`.

3. **Process** (`POST /api/process/:fileId`)
   - Requires `is_valid=true`.
   - Uploads PDF to Gemini, requests JSON with:
     ```json
     {
       "merchant_name": "...",
       "purchased_at": "YYYY-MM-DD HH:mm:ss",
       "total_amount": 0.00,
       "category": "single_word",
       "items": [{"name":"...","price":0.00,"quantity":1}, ...]
     }
     ```
   - Parses and normalizes fields.
   - Moves PDF to `uploads/<year>/<category>/`.
   - Updates `receipt_file`: `is_processed=true`, new `file_path`.
   - Inserts/updates `receipt` with extracted data and raw JSON.

4. **List Files** (`GET /api/files`)
   - Returns all `receipt_file` rows (with validation/processing status).

5. **List Receipts** (`GET /api/receipts`)
   - Returns all `receipt` rows joined with original filenames.

6. **Get Receipt** (`GET /api/receipts/:id`)
   - Returns one receipt (with `items` as JSON string).

7. **Delete** (`DELETE /api/receipts/:id`)
   - Deletes `receipt` and `receipt_file` entries.
   - Removes final PDF from `uploads/`.

## Front-End (public/index.html + script.js)
- **Upload Tab**: Select PDF → Upload.
- **Manage Files Tab**: View all uploads, Validate or Process each.
- **Processed Receipts Tab**: View, Download, Details (modal with JSON/items), Delete.
- Built with Bootstrap 5, uses a loader overlay and alerts.

## Run
```bash
npm start
```
Visit `http://localhost:{PORT}` in your browser (or serve via static server).

---