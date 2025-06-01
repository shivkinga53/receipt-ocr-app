import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import path from 'path';
import 'dotenv/config';

// Initialize Gemini API client with your API key
const apiKey = process.env.GEMINI_API_KEY;  // or replace with a string
console.log("API key:", apiKey);

const ai = new GoogleGenAI({ apiKey });

async function main() {
  // Path to the PDF receipt on your local disk
//   const filePath = path.join(process.cwd(), 'receipt.pdf');
  const filePath = "2018/public transport/bart-43253423.pdf";
  // Upload the PDF file to Gemini API
  const file = await ai.files.upload({ 
    file: filePath, 
    config: { mimeType: 'application/pdf' } 
  });
  console.log("Uploaded file name:", file.name, "URI:", file.uri);

  // Prepare a prompt to extract key details from the receipt
  const prompt = "\nExtract vendor, date (yyyy-MM-dd format), total and item details from this receipt.";
  const content = createUserContent([
    createPartFromUri(file.uri, file.mimeType),
    prompt
  ]);

  // Call the model to process the PDF
  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',   // or another Gemini model with vision
    contents: content
  });
  console.log("Model output:\n", result.text);
}

main().catch(err => console.error(err));
