// server.js
import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { dbRun, dbGet, dbAll } from "./database.js";

// Updated @google/genai import
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Ensure the TEMP_DIR and UPLOAD_DIR exist, but first clear out any old files
// ─────────────────────────────────────────────────────────────────────────────
const TEMP_DIR = path.join(__dirname, "temp");
const UPLOAD_DIR = path.join(__dirname, "uploads");

// Helper to synchronously delete a folder and recreate it empty:
function resetFolder(folderPath) {
  if (fs.existsSync(folderPath)) {
    // fs.rmSync is available in Node 14+. If you need older Node, use fs.rmdirSync with recursive.
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
  fs.mkdirSync(folderPath, { recursive: true });
}

// On server start, clear both temp and uploads:
resetFolder(TEMP_DIR);
resetFolder(UPLOAD_DIR);

// ─────────────────────────────────────────────────────────────────────────────
// Multer setup: store uploads **temporarily** in ./temp, keep original filename
// ─────────────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    // Replace spaces with underscores, keep original name
    const sanitized = file.originalname.replace(/\s+/g, "_");
    cb(null, sanitized);
  },
});
const fileFilter = (req, file, cb) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed!"), false);
  }
};
const upload = multer({ storage, fileFilter });

app.use(express.json());
app.use(cors());
// Serve static so that final uploads (and temp, if ever needed) can be downloaded
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));
// Note: we do NOT expose /temp via static—PDFs in temp are only used server‐side

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenAI({ apiKey });

// --- API Endpoints ---

/**
 * 1. POST /api/upload
 *    - Stores the uploaded PDF into ./temp/<original_sanitized_name>.pdf
 *    - Records it in `receipt_file` with file_path pointing to that temp location.
 */
app.post("/api/upload", upload.single("receiptPdf"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ message: "No file uploaded or incorrect field name." });
  }

  const { filename } = req.file; // e.g. 'My_Invoice.pdf'
  const absoluteTempPath = req.file.path; 
  const relativeTempPath = path
    .relative(__dirname, absoluteTempPath)
    .replace(/\\/g, "/"); // e.g. "temp/My_Invoice.pdf"

  try {
    // 1) Look for an existing record by file_name (not file_path).
    //    That ensures we replace the old temp–record instead of inserting anew.
    const existingByName = await dbGet(
      `SELECT id, file_path 
         FROM receipt_file 
        WHERE file_name = ?`,
      [filename]
    );

    if (existingByName) {
      // 2) If that row’s file_path pointed to the old temp location, delete it:
      //    (This makes sure multer’s new upload isn’t conflicted.)
      if (
        existingByName.file_path &&
        existingByName.file_path.startsWith("temp/")
      ) {
        const oldTempAbsolute = path.join(__dirname, existingByName.file_path);
        if (fs.existsSync(oldTempAbsolute)) {
          fs.unlinkSync(oldTempAbsolute);
        }
      }

      // 3) Now update that same row:
      //    • point its file_path back to the new temp path
      //    • reset is_valid & is_processed so the client can validate → process again
      await dbRun(
        `UPDATE receipt_file
            SET file_path     = ?,
                is_valid      = FALSE,
                invalid_reason= NULL,
                is_processed  = FALSE,
                updated_at    = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [relativeTempPath, existingByName.id]
      );

      return res.status(200).json({
        message: "Replaced existing temp file; record updated for re‐processing.",
        fileId: existingByName.id,
        fileName: filename,
        filePath: relativeTempPath,
      });
    }

    // 4) No existing row with this file_name: insert a brand‐new record
    const result = await dbRun(
      `INSERT INTO receipt_file
         (file_name, file_path, is_valid, is_processed)
       VALUES (?, ?, ?, ?)`,
      [filename, relativeTempPath, false, false]
    );

    return res.status(201).json({
      message: "File uploaded to temp successfully.",
      fileId: result.lastID,
      fileName: filename,
      filePath: relativeTempPath,
    });
  } catch (error) {
    console.error("Error in /api/upload:", error.message);
    if (error.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ message: "File path conflict." });
    }
    return res
      .status(500)
      .json({ message: "Error saving file metadata.", error: error.message });
  }
});

/**
 * 2. POST /api/validate/:fileId
 *    - Checks that the file still exists in temp (temp/<name>.pdf).
 *    - Sets is_valid = TRUE if found, otherwise FALSE with an invalid_reason.
 */
app.post("/api/validate/:fileId", async (req, res) => {
  const { fileId } = req.params;
  try {
    const fileRecord = await dbGet(
      "SELECT file_path FROM receipt_file WHERE id = ?",
      [fileId]
    );
    if (!fileRecord) {
      return res.status(404).json({ message: "File record not found." });
    }

    const fullTempPath = path.join(__dirname, fileRecord.file_path);
    if (fs.existsSync(fullTempPath)) {
      await dbRun(
        "UPDATE receipt_file SET is_valid = TRUE, invalid_reason = NULL WHERE id = ?",
        [fileId]
      );
      return res.json({
        message: "File marked as valid (exists in temp).",
        fileId,
        isValid: true,
      });
    } else {
      await dbRun(
        `UPDATE receipt_file
           SET is_valid = FALSE,
               invalid_reason = 'File not found in temp folder.'
         WHERE id = ?`,
        [fileId]
      );
      return res.status(400).json({
        message: "File not found in temp folder; marked as invalid.",
        fileId,
        isValid: false,
      });
    }
  } catch (error) {
    console.error("Error in /api/validate:", error.message);
    return res
      .status(500)
      .json({ message: "Error during validation.", error: error.message });
  }
});

/**
 * 3. POST /api/process/:fileId
 *    - Finds the PDF in temp (temp/<name>.pdf), uploads to Gemini, gets JSON.
 *    - Extracts { merchant_name, purchased_at, total_amount, category, items }.
 *    - Moves the PDF from temp → structured: uploads/<year>/<category>/<originalName>.pdf.
 *    - Updates receipt_file.file_path = 'uploads/<year>/<category>/<originalName>.pdf' and is_processed = TRUE.
 *    - Inserts/updates a row in `receipt` with the JSON + new file_path.
 */
app.post("/api/process/:fileId", async (req, res) => {
  const { fileId } = req.params;

  try {
    // 1) Fetch receipt_file record (to get temp path & is_valid)
    const fileRecord = await dbGet(
      "SELECT file_path, is_valid, file_name FROM receipt_file WHERE id = ?",
      [fileId]
    );
    if (!fileRecord) {
      return res.status(404).json({ message: "File record not found." });
    }
    if (!fileRecord.is_valid) {
      return res.status(400).json({
        message: "File is not validated. Please validate before processing.",
      });
    }

    // fullTempPath = where Multer placed it: ./temp/<originalName>.pdf
    const fullTempPath = path.join(__dirname, fileRecord.file_path);
    if (!fs.existsSync(fullTempPath)) {
      await dbRun(
        `UPDATE receipt_file
            SET is_processed = FALSE,
                invalid_reason = 'File not found in temp during processing.'
          WHERE id = ?`,
        [fileId]
      );
      return res.status(404).json({
        message: `File not found at temp path: ${fileRecord.file_path}`,
      });
    }

    // 2) Upload to Gemini
    console.log(`Uploading ${fullTempPath} to Gemini...`);
    const uploadedFile = await genAI.files.upload({
      file: fullTempPath,
      config: { mimeType: "application/pdf" },
    });
    console.log(
      "Uploaded file name to GenAI:",
      uploadedFile.name,
      "URI:",
      uploadedFile.uri
    );

    // 3) Build prompt asking for JSON with items array
    const promptText = `\nExtract 
        vendor, 
        date (yyyy-MM-dd HH:mm:ss format if timestamp not available then some kind or relatable date which is relevant to invoice), 
        total, 
        single word category and 
        item details (like an array) from this receipt. and give it in this object json format in this format 
        {
            "merchant_name": "Example Store",
            "purchased_at": "2023-10-26 14:30:00",
            "total_amount": 123.45,
            "category": "Groceries",
            "items": [
                {"name": "Item 1", "price": 10.99, "quantity": 2},
            ]
        }.
    `;
    const contentForModel = createUserContent([
      createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
      promptText,
    ]);

    // 4) Call Gemini model
    const modelToUse = "gemini-2.0-flash";
    console.log(
      `Calling model ${modelToUse} with file URI: ${uploadedFile.uri}`
    );
    const generationConfig = {
      temperature: 0.1,
      maxOutputTokens: 2048,
    };
    const safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ];
    const aiResult = await genAI.models.generateContent({
      model: modelToUse,
      contents: [contentForModel],
      generationConfig,
      safetySettings,
    });

    let aiResponseText = aiResult.text || "";
    aiResponseText = aiResponseText.replace(/^```json\s*|```$/g, "").trim();
    console.log("Cleaned AI Response:", aiResponseText);

    // 5) Parse JSON
    let extractedData;
    try {
      if (!aiResponseText) throw new Error("AI returned empty response.");
      extractedData = JSON.parse(aiResponseText);
    } catch (parseError) {
      console.error("AI Response not valid JSON:", aiResponseText);
      await dbRun(
        `UPDATE receipt_file
            SET is_processed = FALSE,
                invalid_reason = 'AI response not valid JSON or empty.'
          WHERE id = ?`,
        [fileId]
      );
      return res.status(500).json({
        message:
          "AI processing failed: Could not parse JSON from response or it was empty.",
        rawResponse: aiResponseText,
      });
    }

    if (Array.isArray(extractedData)) {
      extractedData = extractedData[0];
    }
    let {
      total_amount,
      category,
      merchant_name,
      purchased_at,
      items,
    } = extractedData;

    // If purchased_at has no time, append “00:00:00”
    if (purchased_at && !purchased_at.includes(":")) {
      purchased_at += " 00:00:00";
    }
    category = String(category).trim().toLowerCase();

    if (total_amount !== null && typeof total_amount !== "number") {
      const parsedAmt = parseFloat(total_amount);
      total_amount = isNaN(parsedAmt) ? null : parsedAmt;
    }
    if (!Array.isArray(items)) {
      items = [];
    }
    const itemsJson = JSON.stringify(items);

    // ───────────────────────────────────────────────────────────────────────────
    // 6) Move PDF from temp → uploads/<year>/<category>/<originalName>
    // ───────────────────────────────────────────────────────────────────────────
    // Derive <year> from purchased_at, e.g. "2025"
    const year = purchased_at.split("-")[0] || "unknown_year";
    // Sanitize category for filesystem (lowercase, underscores)
    const categorySafe = category.replace(/\s+/g, "_").toLowerCase();
    const targetDir = path.join(UPLOAD_DIR, year, categorySafe);
    fs.mkdirSync(targetDir, { recursive: true });

    // The original sanitized filename is in fileRecord.file_name
    // We stored fileRecord.file_name at upload, but fileRecord.file_path = 'temp/<name>.pdf'
    const originalFilename = fileRecord.file_name.replace(/\s+/g, "_");
    const newAbsolutePath = path.join(targetDir, originalFilename);
    const newRelativePath = path
      .relative(__dirname, newAbsolutePath)
      .replace(/\\/g, "/"); // "uploads/2025/groceries/My_Invoice.pdf"

    // If something already exists there, remove it first
    if (fs.existsSync(newAbsolutePath)) {
      fs.unlinkSync(newAbsolutePath);
    }
    // Move (rename) from temp → final uploads folder
    fs.renameSync(fullTempPath, newAbsolutePath);

    // 7) Update receipt_file.file_path to point at final location, mark is_processed = TRUE
    await dbRun(
      `UPDATE receipt_file
         SET file_path    = ?,
             is_processed = TRUE,
             updated_at   = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newRelativePath, fileId]
    );

    // 8) Insert or Update into `receipt` table
    const existingReceipt = await dbGet(
      "SELECT id FROM receipt WHERE receipt_file_id = ?",
      [fileId]
    );

    if (existingReceipt) {
      // Update existing receipt row
      await dbRun(
        `UPDATE receipt
           SET purchased_at      = ?,
               merchant_name     = ?,
               total_amount      = ?,
               category          = ?,
               items             = ?,
               file_path         = ?,
               raw_extracted_text= ?
         WHERE receipt_file_id = ?`,
        [
          purchased_at,
          merchant_name,
          total_amount,
          category,
          itemsJson,
          newRelativePath,
          aiResponseText,
          fileId,
        ]
      );
      return res.json({
        message: "Receipt data updated.",
        receiptId: existingReceipt.id,
        extractedData,
      });
    } else {
      // Insert new receipt row
      const newReceipt = await dbRun(
        `INSERT INTO receipt
           (receipt_file_id, purchased_at, merchant_name, total_amount, category, items, file_path, raw_extracted_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileId,
          purchased_at,
          merchant_name,
          total_amount,
          category,
          itemsJson,
          newRelativePath,
          aiResponseText,
        ]
      );
      return res.status(201).json({
        message: "Receipt processed and stored.",
        receiptId: newReceipt.lastID,
        extractedData,
      });
    }
  } catch (error) {
    console.error("Error in /api/process:", error.message, error.stack);
    // Attempt to mark the file as “not processed”
    await dbRun(
      `UPDATE receipt_file
         SET is_processed = FALSE,
             invalid_reason = ?
       WHERE id = ?`,
      [`Processing error: ${error.message.substring(0, 200)}`, fileId]
    ).catch((e) =>
      console.error("Failed to update file status on error:", e)
    );
    let userMessage = "AI processing failed.";
    if (error.response && error.response.promptFeedback) {
      userMessage += ` Prompt feedback: ${JSON.stringify(
        error.response.promptFeedback
      )}`;
    } else if (error.message.includes("quota")) {
      userMessage = "AI processing failed due to rate limiting or quota issues.";
    }
    return res.status(500).json({ message: userMessage, errorDetail: error.message });
  }
});

/**
 * 4. DELETE /api/receipts/:id
 *    - Deletes the receipt row, its receipt_file row, and the FINAL PDF on disk (in ./uploads).
 *    - Does NOT try to delete any temp PDF (because temp was already moved or cleared on startup).
 */
app.delete("/api/receipts/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const receiptRow = await dbGet(
      "SELECT receipt_file_id FROM receipt WHERE id = ?",
      [id]
    );
    if (!receiptRow) {
      return res.status(404).json({ message: "Receipt not found." });
    }

    const fileId = receiptRow.receipt_file_id;
    const fileRow = await dbGet(
      "SELECT file_path FROM receipt_file WHERE id = ?",
      [fileId]
    );

    await dbRun("BEGIN TRANSACTION");
    await dbRun("DELETE FROM receipt WHERE id = ?", [id]);
    await dbRun("DELETE FROM receipt_file WHERE id = ?", [fileId]);
    await dbRun("COMMIT");

    if (fileRow && fileRow.file_path) {
      const absoluteFinalPath = path.join(__dirname, fileRow.file_path);
      fs.unlink(absoluteFinalPath, (err) => {
        if (err && err.code !== "ENOENT") {
          console.error(
            `Warning: could not delete final PDF at ${absoluteFinalPath}:`,
            err.message
          );
        }
      });
    }

    return res.json({
      message: "Receipt and file entry deleted successfully.",
    });
  } catch (error) {
    console.error("Error in DELETE /api/receipts/:id:", error.message);
    try {
      await dbRun("ROLLBACK");
    } catch (_) {
      // ignore
    }
    return res
      .status(500)
      .json({ message: "Error deleting receipt.", error: error.message });
  }
});

/**
 * 5. GET /api/receipts
 *    - Unchanged: returns all receipts (including file_path pointing into ./uploads).
 */
app.get("/api/receipts", async (req, res) => {
  try {
    const sql = `
      SELECT r.*, rf.file_name AS original_file_name
        FROM receipt r
        JOIN receipt_file rf ON r.receipt_file_id = rf.id
    ORDER BY r.purchased_at DESC, r.created_at DESC`;
    const rows = await dbAll(sql);
    res.json(rows);
  } catch (error) {
    console.error("Error in /api/receipts:", error.message);
    res
      .status(500)
      .json({ message: "Error fetching receipts.", error: error.message });
  }
});

/**
 * 6. GET /api/receipts/:id
 *    - Unchanged: returns a single receipt’s details (with items as JSON string).
 */
app.get("/api/receipts/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT r.*, rf.file_name AS original_file_name
        FROM receipt r
        JOIN receipt_file rf ON r.receipt_file_id = rf.id
       WHERE r.id = ?`;
    const row = await dbGet(sql, [id]);
    if (!row) {
      return res.status(404).json({ message: "Receipt not found." });
    }
    res.json(row);
  } catch (error) {
    console.error("Error in /api/receipts/:id:", error.message);
    res.status(500).json({
      message: "Error fetching receipt details.",
      error: error.message,
    });
  }
});

/**
 * 7. GET /api/files
 *    - Returns all receipt_file records. Their file_path will point to temp/… until processed.
 */
app.get("/api/files", async (req, res) => {
  try {
    const sql =
      "SELECT id, file_name, file_path, is_valid, invalid_reason, is_processed, created_at, updated_at FROM receipt_file ORDER BY created_at DESC";
    const rows = await dbAll(sql);
    res.json(rows);
  } catch (error) {
    console.error("Error in /api/files:", error.message);
    res
      .status(500)
      .json({ message: "Error fetching files.", error: error.message });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err.message, err.stack);
  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .json({ message: `File upload error: ${err.message}`, code: err.code });
  }
  if (err.message === "Only PDF files are allowed!") {
    return res.status(400).json({ message: err.message });
  }
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      message: err.message || "An unexpected server error occurred.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running in ESM mode on http://localhost:${PORT}`);
});
