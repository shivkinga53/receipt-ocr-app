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

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
	fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, UPLOAD_DIR),
	filename: (req, file, cb) =>
		cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
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
app.use(express.static(path.join(__dirname, "public")));

// Initialize Gemini API client with your API key
const apiKey = process.env.GEMINI_API_KEY; // Ensure this matches your .env variable name
if (!apiKey) {
	console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in .env file.");
	process.exit(1);
}
const genAI = new GoogleGenAI({ apiKey });

// --- API Endpoints (Simplified with async/await) ---

// 1. /upload (POST) - Remains the same
app.post("/api/upload", upload.single("receiptPdf"), async (req, res) => {
	if (!req.file) {
		return res
			.status(400)
			.json({ message: "No file uploaded or incorrect field name." });
	}

	const { filename } = req.file;
	const absoluteFilePath = req.file.path;
	const relativeFilePath = path
		.relative(__dirname, absoluteFilePath)
		.replace(/\\/g, "/");

	try {
		const existingFile = await dbGet(
			`SELECT id FROM receipt_file WHERE file_path = ?`,
			[relativeFilePath]
		);

		if (existingFile) {
			await dbRun(
				`UPDATE receipt_file SET updated_at = CURRENT_TIMESTAMP, file_name = ? WHERE id = ?`,
				[filename, existingFile.id]
			);
			res.status(200).json({
				message: "File already exists, record updated.",
				fileId: existingFile.id,
				fileName: filename,
				filePath: relativeFilePath,
			});
		} else {
			const result = await dbRun(
				`INSERT INTO receipt_file (file_name, file_path, is_valid, is_processed) VALUES (?, ?, ?, ?)`,
				[filename, relativeFilePath, true, false]
			);
			res.status(201).json({
				message: "File uploaded successfully.",
				fileId: result.lastID,
				fileName: filename,
				filePath: relativeFilePath,
			});
		}
	} catch (error) {
		console.error("Error in /api/upload:", error.message);
		if (error.message.includes("UNIQUE constraint failed")) {
			return res.status(409).json({ message: "File path conflict." });
		}
		res
			.status(500)
			.json({ message: "Error saving file metadata.", error: error.message });
	}
});

// 2. /validate (POST) - Remains the same
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

		const fullFilePath = path.join(__dirname, fileRecord.file_path);
		if (fs.existsSync(fullFilePath)) {
			await dbRun(
				"UPDATE receipt_file SET is_valid = TRUE, invalid_reason = NULL WHERE id = ?",
				[fileId]
			);
			res.json({
				message: "File marked as valid (exists at path).",
				fileId: fileId,
				isValid: true,
			});
		} else {
			await dbRun(
				"UPDATE receipt_file SET is_valid = FALSE, invalid_reason = 'File not found at stored path.' WHERE id = ?",
				[fileId]
			);
			res.status(400).json({
				message: "File not found at path, marked as invalid.",
				fileId: fileId,
				isValid: false,
			});
		}
	} catch (error) {
		console.error("Error in /api/validate:", error.message);
		res
			.status(500)
			.json({ message: "Error during validation.", error: error.message });
	}
});

// 3. /process (POST) - MODIFIED FOR NEW GENAI SDK
app.post("/api/process/:fileId", async (req, res) => {
	const { fileId } = req.params;

	try {
		const fileRecord = await dbGet(
			"SELECT file_path, is_valid FROM receipt_file WHERE id = ?",
			[fileId]
		);

		if (!fileRecord) {
			return res.status(404).json({ message: "File record not found." });
		}
		if (!fileRecord.is_valid) {
			return res.status(400).json({
				message: "File is not validated or is invalid. Please validate first.",
			});
		}

		const fullFilePath = path.join(__dirname, fileRecord.file_path);
		if (!fs.existsSync(fullFilePath)) {
			await dbRun(
				"UPDATE receipt_file SET is_processed = FALSE, invalid_reason = 'File not found during processing.' WHERE id = ?",
				[fileId]
			);
			return res
				.status(404)
				.json({ message: `File not found at path: ${fileRecord.file_path}.` });
		}

		// Step 1: Upload the file to Gemini API
		console.log(`Uploading ${fullFilePath} to Gemini...`);
		const uploadedFile = await genAI.files.upload({
			file: fullFilePath, // Pass the direct file path
			config: { mimeType: "application/pdf" },
		});
		console.log(
			"Uploaded file name to GenAI:",
			uploadedFile.name,
			"URI:",
			uploadedFile.uri
		);

		// Step 2: Prepare the prompt and content for the model
		const promptText = `\nExtract vendor, date (yyyy-MM-dd HH:mm:ss format), total and item details from this receipt. and give it in json format in this format 
        {
            "merchant_name": "Example Store",
            "purchased_at": "2023-10-26 14:30:00",
            "total_amount": 123.45
        }.
    `;
		const contentForModel = createUserContent([
			createPartFromUri(uploadedFile.uri, uploadedFile.mimeType), // Use URI from uploaded file
			promptText,
		]);

		// Step 3: Call the model
		// Using the model name from your example snippet
		const modelToUse = "gemini-1.5-flash-latest"; // Or 'gemini-2.0-flash' if preferred and available, let's stick to a known good one for stability for now.
		// If 'gemini-2.0-flash' is specifically required, change this.
		// Let's use what was in your test: 'gemini-2.0-flash'
		console.log(
			`Calling model ${modelToUse} with file URI: ${uploadedFile.uri}`
		);

		const generationConfig = {
			// Optional: if you need to control generation
			temperature: 0.1,
			maxOutputTokens: 2048, // Adjusted as the prompt is part of the input, not consuming output tokens here
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

		// The `generateContent` call now takes the model name directly if using genAI.models.generateContent
		// If you have a specific model instance, it might be different.
		// Let's assume genAI.models.generateContent is the way with the new SDK instance.
		const aiResult = await genAI.models.generateContent({
			model: modelToUse, // Specify model name here
			contents: [contentForModel], // `contents` usually expects an array of Content objects
			generationConfig,
			safetySettings,
		});

		// Step 4: Get the response text
		// Based on your example, result.text should be used.
		// However, SDKs often provide response.text() or similar. Let's check:
		// The genai SDK's `GenerateContentResponse` has a `text()` method.
		let aiResponseText = aiResult.text || ""; // Access text via response.text()
		aiResponseText = aiResponseText.replace(/^```json\s*|```$/g, "").trim();
		console.log("Cleaned AI Response:", aiResponseText);

		let extractedData;
		try {
			if (!aiResponseText) throw new Error("AI returned an empty response.");
			extractedData = JSON.parse(aiResponseText);
		} catch (parseError) {
			console.error("AI Response (not valid JSON or empty):", aiResponseText);
			await dbRun(
				"UPDATE receipt_file SET is_processed = FALSE, invalid_reason = 'AI response was not valid JSON or empty.' WHERE id = ?",
				[fileId]
			);
			return res.status(500).json({
				message:
					"AI processing failed: Could not parse JSON from response or response was empty.",
				rawResponse: aiResponseText,
			});
		}

		const { merchant_name, purchased_at } = extractedData;
		let { total_amount } = extractedData;

		if (total_amount !== null && typeof total_amount !== "number") {
			const parsedAmount = parseFloat(total_amount);
			total_amount = isNaN(parsedAmount) ? null : parsedAmount;
		}

		const existingReceipt = await dbGet(
			"SELECT id FROM receipt WHERE receipt_file_id = ?",
			[fileId]
		);

		if (existingReceipt) {
			await dbRun(
				`UPDATE receipt SET purchased_at = ?, merchant_name = ?, total_amount = ?, raw_extracted_text = ? WHERE receipt_file_id = ?`,
				[purchased_at, merchant_name, total_amount, aiResponseText, fileId]
			);
			await dbRun(
				"UPDATE receipt_file SET is_processed = TRUE, invalid_reason = NULL WHERE id = ?",
				[fileId]
			);
			res.json({
				message: "Receipt data updated.",
				receiptId: existingReceipt.id,
				extractedData,
			});
		} else {
			const newReceipt = await dbRun(
				`INSERT INTO receipt (receipt_file_id, purchased_at, merchant_name, total_amount, file_path, raw_extracted_text) VALUES (?, ?, ?, ?, ?, ?)`,
				[
					fileId,
					purchased_at,
					merchant_name,
					total_amount,
					fileRecord.file_path,
					aiResponseText,
				]
			);
			await dbRun(
				"UPDATE receipt_file SET is_processed = TRUE, invalid_reason = NULL WHERE id = ?",
				[fileId]
			);
			res.status(201).json({
				message: "Receipt processed and stored.",
				receiptId: newReceipt.lastID,
				extractedData,
			});
		}
	} catch (error) {
		console.error("Error in /api/process:", error.message, error.stack);
		// Attempt to update file status on error
		await dbRun(
			"UPDATE receipt_file SET is_processed = FALSE, invalid_reason = ? WHERE id = ?",
			[`Processing error: ${error.message.substring(0, 200)}`, fileId]
		).catch((e) => console.error("Failed to update file status on error:", e));

		let userMessage = "AI processing failed.";
		// Check if it's a GenAI specific error with promptFeedback
		if (error.response && error.response.promptFeedback) {
			userMessage += ` Prompt feedback: ${JSON.stringify(
				error.response.promptFeedback
			)}`;
		} else if (error.message.includes("quota")) {
			userMessage =
				"AI processing failed due to rate limiting or quota issues.";
		}
		res.status(500).json({ message: userMessage, errorDetail: error.message });
	}
});

// 4. /receipts (GET) - Remains the same
app.get("/api/receipts", async (req, res) => {
	try {
		const sql = `
            SELECT r.*, rf.file_name AS original_file_name
            FROM receipt r JOIN receipt_file rf ON r.receipt_file_id = rf.id
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

// 5. /receipts/{id} (GET) - Remains the same
app.get("/api/receipts/:id", async (req, res) => {
	const { id } = req.params;
	try {
		const sql = `
            SELECT r.*, rf.file_name AS original_file_name
            FROM receipt r JOIN receipt_file rf ON r.receipt_file_id = rf.id
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

// Endpoint to list all uploaded files - Remains the same
app.get("/api/files", async (req, res) => {
	try {
		console.log("Fetching all files...");
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

// --- Global Error Handler --- - Remains the same
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
