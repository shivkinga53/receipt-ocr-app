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
  const filePath = "bart-43253423.pdf";
  // Upload the PDF file to Gemini API
  const file = await ai.files.upload({ 
    file: filePath, 
    config: { mimeType: 'application/pdf' } 
  });
  console.log("Uploaded file name:", file.name, "URI:", file.uri);

  // Prepare a prompt to extract key details from the receipt
  const prompt =`Extract the following details from this receipt and respond strictly with a JSON object:
- Merchant Name (key: "merchant_name", type: string)
- Purchase Date and Time (key: "purchased_at", type: string, format: "YYYY-MM-DD HH:MM:SS" if possible, otherwise as seen)
- Total Amount (key: "total_amount", type: number)
Example:
{
  "merchant_name": "Example Store",
  "purchased_at": "2023-10-26 14:30:00",
  "total_amount": 123.45
}
If a field cannot be found or determined, use null for its value.
Ensure the output is only the JSON object, with no surrounding text or markdown.`;
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
