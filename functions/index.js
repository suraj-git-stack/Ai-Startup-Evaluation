
const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const pdf = require('pdf-parse');

// Try to import Vertex AI (with fallback)
let VertexAI;
try {
  const vertexai = require('@google-cloud/vertexai');
  VertexAI = vertexai.VertexAI;
  logger.info('Vertex AI SDK loaded successfully');
} catch (importError) {
  logger.warn('Vertex AI SDK not available:', importError.message);
  VertexAI = null;
}

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// Simple test function
exports.helloWorld = onCall((request) => {
  logger.info("Hello World called!", { user: request.auth?.uid });
  
  return {
    message: "Hello from Firebase Functions v2 with AI!",
    timestamp: new Date().toISOString(),
    aiAvailable: !!VertexAI
  };
});

// Health check
exports.healthCheck = onCall(() => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    project: 'startup-evaluation-472010',
    aiAvailable: !!VertexAI,
    services: {
      storage: 'available',
      pdfParse: 'working',
      vertexAI: VertexAI ? 'ready' : 'setup required'
    }
  };
});

// Test storage access
exports.testStorageAccess = onCall(async (request) => {
  try {
    const { pdfUrl } = request.data;
    if (!pdfUrl) return {success: false, error: 'No PDF URL'};
    const filePath = parseFilePath(pdfUrl);
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) return {success: false, error: 'File not found'};
    const [metadata] = await file.getMetadata();
    return {
      success: true,
      message: 'Storage access confirmed',
      size: metadata.size,
      contentType: metadata.contentType
    };
  } catch (error) {
    logger.error('Test storage failed:', error);
    return {success: false, error: error.message};
  }
});

// AI-Powered PDF processing
exports.processPitchDeck = onCall(async (request) => {
  const startTime = Date.now();
  logger.info('=== AI PITCH DECK ANALYSIS START ===', { 
    user: request.auth?.uid, 
    pdfUrl: request.data?.pdfUrl 
  });
  
  let extractedText = '';
  let pdfBuffer = null;
  let extractionPrompt = '';
  
  try {
    const { pdfUrl } = request.data;
    if (!pdfUrl) {
      throw new Error('PDF URL is required');
    }
    
    // Step 1: Download PDF from Firebase Storage
    logger.info('Step 1: Downloading PDF...');
    
    // Parse file path from Firebase Storage URL
    let filePath = parseFilePath(pdfUrl);
    logger.info(`Parsed file path: ${filePath}`);
    
    // Download from Firebase Storage
    const bucket = admin.storage().bucket('startup-evaluation-472010.firebasestorage.app');
    const file = bucket.file(filePath);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`PDF file not found: ${filePath}`);
    }
    
    // Download the PDF
    [pdfBuffer] = await file.download();
    logger.info(`PDF downloaded successfully: ${pdfBuffer.length} bytes`);
    
    // Verify PDF format
    const header = pdfBuffer.toString('utf8', 0, 8);
    if (!header.startsWith('%PDF')) {
      throw new Error(`Invalid PDF format. Header: ${header}`);
    }
    
    // Step 2: Extract text from PDF
    logger.info('Step 2: Extracting text with pdf-parse...');
    const pdfData = await pdf(pdfBuffer);
    
    // Clean and normalize extracted text
    extractedText = pdfData.text
      .replace(/\s+/g, ' ')
      .replace(/Page \d+/gi, '')
      .replace(/^\s*$\n/gm, '')
      .trim();
    
    logger.info(`Extracted ${extractedText.length} characters of text`);
    
    if (extractedText.length < 100) {
      logger.warn(`Very short document (${extractedText.length} chars) - using fallback`);
      throw new Error(`Document too short for analysis (${extractedText.length} chars)`);
    }
    
    // Step 3: Create AI prompt
    logger.info('Step 3: Creating AI prompt...');
    extractionPrompt = `You are an expert venture capital analyst extracting structured information from startup pitch decks and professional documents.

ANALYZE this document and extract the following information as a VALID JSON object. Use "Not specified in document" for missing information.

{
  "company": "Company name or person's full name",
  "valueProposition": "Core value proposition or what they do in 1-2 sentences",
  "marketSize": "Market size, TAM/SAM/SOM if mentioned, or industry size estimate",
  "traction": "Key metrics: users, revenue, customers, growth, achievements",
  "team": "Key team members, founders, their experience and roles",
  "fundingAsk": "Investment amount requested and round type if mentioned",
  "useOfFunds": "How they plan to use the funding",
  "businessModel": "Revenue model, pricing strategy if mentioned",
  "competitiveLandscape": "Competitors or key differentiation if mentioned",
  "goToMarket": "Customer acquisition strategy or target market"
}

RULES:
- Be specific with numbers and metrics when available
- Use "Not specified in document" for missing information  
- Keep descriptions concise but informative
- For professional resumes: extract name, role, experience, skills
- Return ONLY valid JSON - no explanations, no markdown, no additional text

DOCUMENT CONTENT (${extractedText.length} characters):
${extractedText.substring(0, 8000)}

Respond with ONLY the JSON object above:`;
    
    logger.info(`Prompt created (${extractionPrompt.length} chars)`);
    
    // Step 4: AI Analysis with Vertex AI
    logger.info('Step 4: Starting AI analysis...');
    let aiData = {
      company: 'AI Analysis (Processing)',
      valueProposition: `Document contains ${extractedText.length} characters of professional content`,
      marketSize: 'Not available without AI setup',
      traction: `Processed ${extractedText.length} characters successfully`,
      team: 'Document team information requires AI analysis',
      fundingAsk: 'Funding information requires AI analysis',
      useOfFunds: 'Funding usage requires AI analysis',
      businessModel: 'Business model requires AI analysis',
      competitiveLandscape: 'Competitive analysis requires AI',
      goToMarket: 'Go-to-market strategy requires AI analysis'
    };
    
    let aiEnabled = false;
    let aiError = null;
    let aiResponse = '';
    
    if (VertexAI) {
      try {
        logger.info('Initializing Vertex AI Gemini 1.5 Flash...');
        
        const vertex_ai = new VertexAI({ 
          project: 'startup-evaluation-472010', 
          location: 'us-central1' 
        });
        
        const model = vertex_ai.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        
        logger.info('Model loaded, generating content...');
        
        const result = await model.generateContent(extractionPrompt);
        
        const candidates = result.response?.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error('No candidates returned from AI');
        }
        
        const parts = candidates[0].content?.parts;
        if (!parts || parts.length === 0) {
          throw new Error('No content parts returned from AI');
        }
        
        aiResponse = parts[0].text;
        if (!aiResponse) {
          throw new Error('No text content returned from AI');
        }
        
        logger.info(`AI Response (${aiResponse.length} chars):`, aiResponse.substring(0, 200));
        
        try {
          aiData = JSON.parse(aiResponse);
          logger.info('Direct JSON parsing successful');
        } catch (parseError) {
          logger.warn('Direct JSON failed, trying regex extraction');
          
          const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            aiData = JSON.parse(jsonMatch[0]);
            logger.info('Regex JSON extraction successful');
          } else {
            logger.error('No valid JSON found in AI response');
            aiData.aiError = `Invalid AI response format: ${aiResponse.substring(0, 300)}`;
          }
        }
        
        aiEnabled = true;
        logger.info('AI Processing Complete');
        
      } catch (error) {
        logger.error('AI Processing Failed:', error.message);
        
        aiError = error.message || 'Unknown AI error';
        if (aiError.includes('permission')) {
          aiData.aiError = 'Vertex AI permissions required - check IAM roles';
        } else if (aiError.includes('API not enabled')) {
          aiData.aiError = 'Vertex AI API needs to be enabled in Google Cloud Console';
        } else if (aiError.includes('quota')) {
          aiData.aiError = 'Vertex AI quota exceeded - check billing';
        } else if (aiError.includes('model')) {
          aiData.aiError = 'Model access required - enable Gemini in Vertex AI Studio';
        } else {
          aiData.aiError = aiError;
        }
      }
    } else {
      logger.warn('Vertex AI SDK not available - install with: npm install @google-cloud/vertexai');
      aiData.aiError = 'Vertex AI SDK not installed';
    }
    
    // Step 5: Validate and complete data structure
    const validatedData = {
      company: aiData.company || 'Document Analysis (AI Setup Required)',
      valueProposition: aiData.valueProposition || `Document contains ${extractedText.length} characters of professional content`,
      marketSize: aiData.marketSize || 'Not available without AI setup',
      traction: aiData.traction || `Processed ${extractedText.length} characters successfully`,
      team: aiData.team || 'Document team information requires AI analysis',
      fundingAsk: aiData.fundingAsk || 'Funding information requires AI analysis',
      useOfFunds: aiData.useOfFunds || 'Funding usage requires AI analysis',
      businessModel: aiData.businessModel || 'Business model requires AI analysis',
      competitiveLandscape: aiData.competitiveLandscape || 'Competitive analysis requires AI',
      goToMarket: aiData.goToMarket || 'Go-to-market strategy requires AI analysis',
      aiStatus: aiEnabled ? 'AI analysis complete' : (aiData.aiError || 'AI setup required')
    };
    
    const extractionId = `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('=== ANALYSIS COMPLETE ===');
    logger.info(`Company: ${validatedData.company}`);
    logger.info(`AI Status: ${validatedData.aiStatus}`);
    logger.info(`Processing time: ${Date.now() - startTime}ms`);
    
    return {
      success: true,
      data: validatedData,
      extractionId: extractionId,
      source: aiEnabled ? 'vertex-ai-gemini-1.5-flash' : 'pdf-fallback',
      pdfSize: pdfBuffer.length,
      textLength: extractedText.length,
      sampleText: extractedText.substring(0, 300),
      aiEnabled: aiEnabled,
      aiTokens: aiEnabled ? extractionPrompt.length + aiResponse.length : 0,
      confidence: aiEnabled ? 'high' : 'medium',
      status: aiEnabled ? 'AI-powered pitch deck analysis complete!' : 'PDF processed successfully, AI setup required',
      processingTime: Date.now() - startTime,
      nextSteps: aiEnabled ? [] : [
        'Enable Vertex AI API in Google Cloud Console',
        'Add "Vertex AI User" role to service account in IAM',
        'Visit Vertex AI Studio to request Gemini model access',
        'Retry analysis to enable AI features'
      ]
    };
    
  } catch (error) {
    logger.error('=== PDF PROCESSING FAILED ===', error);
    
    if (error.message?.includes('not found')) {
      throw new Error('PDF file not found in storage');
    }
    
    const errorMessage = error.message || 'Unknown processing error';
    logger.error(`PDF processing failed: ${errorMessage}`);
    
    throw new Error(`Document processing failed: ${errorMessage}`);
  }
});

// Helper function to parse Firebase Storage path
function parseFilePath(pdfUrl) {
  if (pdfUrl.startsWith("gs://")) {
    const bucketPrefix = `gs://startup-evaluation-472010.firebasestorage.app`;
    if (!pdfUrl.startsWith(bucketPrefix)) {
      throw new Error(`Invalid bucket in URL: ${pdfUrl}`);
    }
    const filePath = pdfUrl.substring(bucketPrefix.length + 1); // Skip the leading '/'
    return decodeURIComponent(filePath);
  }
  
  const nameMatch = pdfUrl.match(/name=([^&]+)/);
  if (nameMatch) {
    return decodeURIComponent(nameMatch[1]);
  }
  
  const pathMatch = pdfUrl.match(/\/o\/([^?]+)/);
  if (pathMatch) {
    return decodeURIComponent(pathMatch[1].replace(/%2F/g, '/'));
  }
  
  throw new Error('Invalid PDF URL format - could not parse file path');
}
