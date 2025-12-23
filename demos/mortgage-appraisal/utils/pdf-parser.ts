/**
 * Real PDF Parser - Extracts text from PDFs
 * Uses pdfjs-dist for text extraction
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as fs from 'fs';

// Configure pdfjs worker
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

/**
 * Extract text from a PDF file
 */
export async function extractTextFromPDF(pdfPath: string): Promise<string> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  
  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;
  
  const numPages = pdfDocument.numPages;
  const textParts: string[] = [];
  
  // Extract text from each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    
    textParts.push(pageText);
  }
  
  return textParts.join('\n\n');
}

/**
 * Extract text from base64 encoded PDF
 */
export async function extractTextFromBase64PDF(base64Data: string): Promise<string> {
  // Remove data URL prefix if present
  const base64WithoutPrefix = base64Data.replace(/^data:application\/pdf;base64,/, '');
  
  // Convert base64 to Uint8Array
  const binaryString = Buffer.from(base64WithoutPrefix, 'base64');
  const data = new Uint8Array(binaryString);
  
  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;
  
  const numPages = pdfDocument.numPages;
  const textParts: string[] = [];
  
  // Extract text from each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    
    textParts.push(pageText);
  }
  
  return textParts.join('\n\n');
}

/**
 * Check if PDF is image-based (scanned) or text-based
 */
export async function isPDFImageBased(pdfPath: string): Promise<boolean> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;
  
  // Check first page
  const page = await pdfDocument.getPage(1);
  const textContent = await page.getTextContent();
  
  // If very little text, likely image-based
  const textLength = textContent.items.map((item: any) => item.str).join('').length;
  
  return textLength < 100; // Threshold for image-based detection
}
