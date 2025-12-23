/**
 * DocumentExtractorActor - Extracts structured data from appraisal PDFs
 * 
 * This actor uses an LLM to parse appraisal documents (text or image-based PDFs)
 * and extract structured data according to a predefined schema.
 */

import { Actor } from '../../../src/actor/actor';
import type { ActorContext } from '../../../src/actor/journal';
import { AppraisalData } from '../types';

export interface DocumentExtractorInput {
  pdfContent: string; // Base64 encoded, text content, or file path
  pdfType: 'text' | 'image';
  schemaHints?: string[]; // Optional hints for extraction
}

export interface DocumentExtractorState extends Record<string, unknown> {
  success: boolean;
  extractedData?: AppraisalData;
  error?: string;
  confidence: number;
}

export class DocumentExtractorActor extends Actor {
  constructor(context: ActorContext, initialState?: Record<string, unknown>) {
    super(context, initialState);
  }

  protected getDefaultState(): Record<string, unknown> {
    return {
      success: false,
      confidence: 0,
    };
  }

  async execute(input: unknown): Promise<void> {
    const typedInput = input as DocumentExtractorInput;
    try {
      console.log(`[${this.context.actorId}] Extracting data from ${typedInput.pdfType} PDF...`);

      // Build extraction prompt
      const prompt = this.buildExtractionPrompt(typedInput);

      // Call LLM to extract structured data
      const llmResponse = await this.callLLM(prompt);

      // Parse JSON response
      const extractedData = this.parseExtractedData(llmResponse);

      // Validate extracted data
      const validation = this.validateExtractedData(extractedData);

      if (!validation.isValid) {
        this.state.success = false;
        this.state.error = `Validation failed: ${validation.errors.join(', ')}`;
        this.state.confidence = 0;
        return;
      }

      console.log(`[${this.context.actorId}] ✅ Data extraction completed successfully`);
      console.log(`[${this.context.actorId}] 📊 EXTRACTED DATA:`);
      console.log(`     Property: ${extractedData.propertyAddress}`);
      console.log(`     Value: $${extractedData.appraisedValue?.toLocaleString()}`);
      console.log(`     Appraiser: ${extractedData.appraiserName}`);
      console.log(`     Comparables: ${extractedData.comparableSales?.length || 0}`);
      console.log(`     Confidence: ${validation.confidence.toFixed(2)}\n`);

      this.state.success = true;
      this.state.extractedData = extractedData;
      this.state.confidence = validation.confidence;
    } catch (error) {
      console.log(`[${this.context.actorId}] Extraction error: ${error}`);
      this.state.success = false;
      this.state.error = error instanceof Error ? error.message : 'Unknown error';
      this.state.confidence = 0;
    }
  }

  private buildExtractionPrompt(input: DocumentExtractorInput): string {
    const schemaDescription = `
{
  "propertyAddress": "string",
  "appraisedValue": "number",
  "effectiveDate": "string (YYYY-MM-DD)",
  "appraiserName": "string",
  "appraiserLicense": "string",
  "propertyType": "string (e.g., Single Family, Condo)",
  "yearBuilt": "number",
  "squareFootage": "number",
  "lotSize": "string",
  "condition": "string",
  "comparableSales": [
    {
      "address": "string",
      "salePrice": "number",
      "saleDate": "string",
      "squareFootage": "number",
      "adjustments": "number"
    }
  ]
}`;

    let prompt = `You are an expert mortgage appraisal document analyzer. Extract structured data from the following appraisal document.

${input.pdfType === 'image' ? 'This is an image-based PDF. Carefully read all text from the image.' : 'This is a text-based PDF.'}

DOCUMENT CONTENT:
${input.pdfContent}

REQUIRED OUTPUT SCHEMA:
${schemaDescription}

${input.schemaHints ? `ADDITIONAL HINTS:\n${input.schemaHints.join('\n')}` : ''}

IMPORTANT EXTRACTION RULES:
1. For propertyAddress: Include COMPLETE address with street, city, state, and ZIP code (e.g., "123 Main Street, Springfield, IL 62701")
2. Extract ALL comparable sales found in the document
3. Parse dates in YYYY-MM-DD format
4. Extract numeric values as numbers, not strings
5. Return ONLY valid JSON - no markdown formatting, no code blocks, no extra text

Extract all relevant data and return valid JSON matching the schema above.`;

    return prompt;
  }

  private parseExtractedData(llmResponse: string): AppraisalData {
    // Remove markdown code blocks if present
    let jsonText = llmResponse.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.substring(7);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.substring(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.substring(0, jsonText.length - 3);
    }

    // Parse JSON
    return JSON.parse(jsonText.trim());
  }

  private validateExtractedData(data: AppraisalData): {
    isValid: boolean;
    errors: string[];
    confidence: number;
  } {
    const errors: string[] = [];
    let confidence = 1.0;

    // Required fields
    if (!data.propertyAddress) {
      errors.push('Missing propertyAddress');
      confidence -= 0.2;
    }
    if (!data.appraisedValue || data.appraisedValue <= 0) {
      errors.push('Invalid appraisedValue');
      confidence -= 0.3;
    }
    if (!data.appraiserName) {
      errors.push('Missing appraiserName');
      confidence -= 0.1;
    }

    // Reasonable value checks
    if (data.appraisedValue && (data.appraisedValue < 10000 || data.appraisedValue > 100000000)) {
      errors.push('Appraisal value outside reasonable range');
      confidence -= 0.2;
    }

    if (data.yearBuilt && (data.yearBuilt < 1700 || data.yearBuilt > new Date().getFullYear() + 2)) {
      errors.push('Year built outside reasonable range');
      confidence -= 0.1;
    }

    if (data.squareFootage && (data.squareFootage < 100 || data.squareFootage > 50000)) {
      errors.push('Square footage outside reasonable range');
      confidence -= 0.1;
    }

    // Comparable sales validation
    if (!data.comparableSales || data.comparableSales.length === 0) {
      confidence -= 0.15; // Not critical but reduces confidence
    }

    return {
      isValid: errors.length === 0,
      errors,
      confidence: Math.max(0, confidence),
    };
  }

  private async callLLM(prompt: string): Promise<string> {
    // Check if we should use real LLM or mock
    const useMock = process.env.USE_MOCK_LLM === 'true' || !process.env.AZURE_OPENAI_API_KEY;
    
    if (useMock) {
      // Mock implementation for testing without API keys
      console.log(`[${this.context.actorId}] Using MOCK LLM for document extraction...`);
      await new Promise(resolve => setTimeout(resolve, 100));

      return JSON.stringify({
        propertyAddress: "123 Main Street, Springfield, IL 62701",
        appraisedValue: 425000,
        effectiveDate: "2024-11-15",
        appraiserName: "John Smith",
        appraiserLicense: "IL-12345",
        propertyType: "Single Family",
        yearBuilt: 2015,
        squareFootage: 2400,
        lotSize: "0.25 acres",
        condition: "Good",
        comparableSales: [
          {
            address: "125 Main Street, Springfield, IL",
            salePrice: 430000,
            saleDate: "2024-09-01",
            squareFootage: 2450,
            adjustments: -5000
          },
          {
            address: "118 Oak Avenue, Springfield, IL",
            salePrice: 415000,
            saleDate: "2024-08-15",
            squareFootage: 2350,
            adjustments: 10000
          }
        ]
      });
    }

    // REAL LLM IMPLEMENTATION
    console.log(`[${this.context.actorId}] Calling REAL LLM (GPT-4) for document extraction...`);
    console.log(`[${this.context.actorId}] 📤 PROMPT (first 500 chars): ${prompt.substring(0, 500)}...`);
    
    const { createLLMService } = await import('../utils/llm-service');
    const llmService = createLLMService('gpt-4');
    
    const systemPrompt = 'You are an expert at extracting structured data from mortgage appraisal documents. Return ONLY valid JSON, no markdown formatting.';
    
    const response = await llmService.prompt(systemPrompt, prompt);
    
    console.log(`[${this.context.actorId}] 📥 LLM RESPONSE (full):\n${response}\n`);
    
    return response;
  }
}
