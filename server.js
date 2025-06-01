// server.js
import "dotenv/config";
import express from "express";
import multer from "multer";
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
app.use(express.static(path.join(__dirname, "public")));

// Initialize Gemini API client with your API key
const apiKey = process.env.GEMINI_API_KEY; // Ensure this matches your .env variable name
if (!apiKey) {
	console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in .env file.");
	process.exit(1);
}
const genAI = new GoogleGenAI({ apiKey }); // Updated initialization

app.listen(PORT, async () => {
	console.log(`Server running in ESM mode on http://localhost:${PORT}`);
	const filePath = "bart_20180908_007.pdf";

	const file = await genAI.files.upload({
		file: filePath,
		config: { mimeType: "application/pdf" },
	});
	console.log("Uploaded file name:", file.name, "URI:", file.uri);

	// Prepare a prompt to extract key details from the receipt
	const prompt =
		"\nExtract vendor, date (yyyy-MM-dd format), total and item details from this receipt. and give it in json format.";
	const content = createUserContent([
		createPartFromUri(file.uri, file.mimeType),
		prompt,
	]);

	// Call the model to process the PDF
	const result = await genAI.models.generateContent({
		model: "gemini-2.0-flash", // or another Gemini model with vision
		contents: content,
	});

    const rawText = result.text;

    console.log("Model output:\n", JSON.parse(rawText.replace(/```json|```/g, '').trim()));
});
