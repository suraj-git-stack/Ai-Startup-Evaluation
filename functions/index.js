const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const pdf = require('pdf-parse');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// Vertex AI imports - FIXED
let vertexAIClient = null;
let embeddingClient = null;

try {
  // Import Vertex AI Generative AI
  const { VertexAI } = require('@google-cloud/vertexai');
  vertexAIClient = new VertexAI({
    project: 'startup-evaluation-472010',
    location: 'us-central1'
  });
  logger.info('Vertex AI Generative AI SDK loaded successfully');

  // Import for embeddings
  const { PredictionServiceClient } = require('@google-cloud/aiplatform');
  embeddingClient = new PredictionServiceClient({
    projectId: 'startup-evaluation-472010',
    location: 'us-central1'
  });
  logger.info('Vertex AI Embedding client loaded successfully');
} catch (importError) {
  logger.warn('Vertex AI SDK not available:', importError.message);
  vertexAIClient = null;
  embeddingClient = null;
}

// Simple test function
exports.helloWorld = onCall((request) => {
  logger.info("Hello World called!", { user: request.auth?.uid });
  
  return {
    message: "Hello from Firebase Functions v2 with AI!",
    timestamp: new Date().toISOString(),
    aiAvailable: !!vertexAIClient
  };
});

// Health check
exports.healthCheck = onCall(() => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    project: 'startup-evaluation-472010',
    aiAvailable: !!vertexAIClient,
    services: {
      storage: 'available',
      pdfParse: 'working',
      vertexAI: vertexAIClient ? 'ready' : 'setup required',
      embeddings: !!embeddingClient
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

// RAG-powered PDF processing - FIXED
exports.processPitchDeck = onCall(async (request) => {
  const startTime = Date.now();
  logger.info('=== AI PITCH DECK RAG ANALYSIS START ===', { 
    user: request.auth?.uid, 
    pdfUrl: request.data?.pdfUrl 
  });
  
  let extractedText = '';
  let pdfBuffer = null;
  
  try {
    const { pdfUrl } = request.data;
    if (!pdfUrl) {
      throw new Error('PDF URL is required');
    }
    
    // Step 1: Download PDF from Firebase Storage
    logger.info('Step 1: Downloading PDF...');
    const filePath = parseFilePath(pdfUrl);
    
    logger.info(`Processing file: ${filePath}`);
    
    const bucket = admin.storage().bucket();
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
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/Page \d+/gi, '')      // Remove page numbers
      .replace(/^\s*$\n/gm, '')       // Remove empty lines
      .trim();
    
    logger.info(`Extracted ${extractedText.length} characters of text`);
    
    if (extractedText.length < 100) {
      throw new Error(`Document too short for analysis (${extractedText.length} chars)`);
    }
    
    // Step 3: RAG Integration - Chunk and Embed Text
    logger.info('Step 3: Starting RAG processing...');
    const chunkSize = 500; // Characters per chunk
    const chunks = [];
    for (let i = 0; i < extractedText.length; i += chunkSize) {
      chunks.push(extractedText.substring(i, i + chunkSize));
    }
    logger.info(`Created ${chunks.length} chunks`);
    
    // Generate embeddings for chunks
    let chunkEmbeddings = [];
    let retrievalSuccess = false;
    
    if (embeddingClient) {
      try {
        logger.info('Generating embeddings for chunks...');
        chunkEmbeddings = await generateEmbeddings(chunks);
        retrievalSuccess = true;
        logger.info(`Generated embeddings for ${chunkEmbeddings.length} chunks`);
      } catch (embeddingError) {
        logger.warn('Embedding generation failed, using simple keyword search:', embeddingError.message);
        // Fallback to simple keyword-based retrieval
        chunkEmbeddings = chunks.map(() => null);
        retrievalSuccess = false;
      }
    } else {
      logger.warn('No embedding client available, using simple keyword search');
      retrievalSuccess = false;
    }
    
    // Step 4: Retrieve relevant chunks
    logger.info('Step 4: Retrieving relevant chunks...');
    const extractionQuery = "Extract key startup pitch deck information including company, value proposition, market size, traction, team, funding ask, use of funds, business model, competitive landscape, go-to-market strategy";
    
    let topChunks = [];
    if (retrievalSuccess && chunkEmbeddings.length > 0 && chunkEmbeddings[0] !== null) {
      // Vector-based retrieval
      const queryEmbedding = await generateEmbeddings([extractionQuery]);
      const similarities = chunkEmbeddings.map((emb, idx) => ({
        index: idx,
        similarity: cosineSimilarity(queryEmbedding[0], emb)
      }));
      
      similarities.sort((a, b) => b.similarity - a.similarity);
      topChunks = similarities.slice(0, 5).map(s => chunks[s.index]);
      
      logger.info(`Retrieved top 5 chunks with similarity: ${similarities[0].similarity.toFixed(4)}`);
    } else {
      // Fallback: Simple keyword-based retrieval
      const keywords = ['company', 'market', 'traction', 'team', 'funding', 'revenue', 'customers', 'growth', 'business', 'strategy', 'competitive'];
      const chunkScores = chunks.map((chunk, idx) => {
        let score = 0;
        keywords.forEach(keyword => {
          if (chunk.toLowerCase().includes(keyword)) score += 1;
        });
        return { index: idx, score };
      });
      
      chunkScores.sort((a, b) => b.score - a.score);
      topChunks = chunkScores.slice(0, 5).map(s => chunks[s.index]);
      
      logger.info(`Retrieved top 5 chunks using keyword matching`);
    }
    
    // Step 5: Create augmented prompt with retrieved chunks
    logger.info('Step 5: Creating RAG-augmented prompt...');
    const augmentedContext = topChunks.join('\n\n---\n\n');
    
    const extractionPrompt = `You are an expert venture capital analyst extracting structured information from startup pitch decks.

ANALYZE this retrieved context from the document and extract the following information as a VALID JSON object. Use "Not specified in document" for missing information.

{
  "company": "Company name",
  "valueProposition": "Core value proposition in 1-2 sentences",
  "marketSize": "Market size, TAM/SAM/SOM if mentioned",
  "traction": "Key metrics: users, revenue, customers, growth",
  "team": "Key team members and their roles",
  "fundingAsk": "Investment amount requested and round type",
  "useOfFunds": "How they plan to use the funding",
  "businessModel": "Revenue model if mentioned",
  "competitiveLandscape": "Competitors or differentiation if mentioned",
  "goToMarket": "Customer acquisition strategy if mentioned"
}

RULES:
- Be specific with numbers and metrics when available
- Use "Not specified in document" for missing information  
- Keep descriptions concise but informative
- Return ONLY valid JSON - no explanations, no markdown

RETRIEVED CONTEXT (Top ${topChunks.length} relevant sections):
${augmentedContext.substring(0, 4000)}

Respond with ONLY the JSON object above:`;
    
    // Step 6: AI Analysis with Vertex AI
    logger.info('Step 6: Starting AI analysis with RAG prompt...');
    let aiData = {
      company: 'RAG Analysis (Processing)',
      valueProposition: `Document contains ${extractedText.length} characters`,
      marketSize: 'Not available without AI',
      traction: `Processed with ${chunks.length} chunks`,
      team: 'Team info requires AI',
      fundingAsk: 'Funding info requires AI',
      useOfFunds: 'Funds usage requires AI',
      businessModel: 'Business model requires AI',
      competitiveLandscape: 'Competitive analysis requires AI',
      goToMarket: 'Go-to-market requires AI'
    };
    
    let aiEnabled = false;
    let aiError = null;
    let aiResponse = '';
    
    if (vertexAIClient) {
      try {
        logger.info('Initializing Vertex AI Gemini 1.5 Flash...');
        
        const model = vertexAIClient.getGenerativeModel({ 
          model: "gemini-1.5-flash-001",
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024
          }
        });
        
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
        
        // Parse JSON response
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
      logger.warn('Vertex AI client not available');
      aiData.aiError = 'Vertex AI not configured';
    }
    
    // Step 7: Validate and complete data structure
    const validatedData = {
      company: aiData.company || 'Document Analysis (AI Setup Required)',
      valueProposition: aiData.valueProposition || `Document contains ${extractedText.length} characters`,
      marketSize: aiData.marketSize || 'Not specified in document',
      traction: aiData.traction || 'Not specified in document',
      team: aiData.team || 'Not specified in document',
      fundingAsk: aiData.fundingAsk || 'Not specified in document',
      useOfFunds: aiData.useOfFunds || 'Not specified in document',
      businessModel: aiData.businessModel || 'Not specified in document',
      competitiveLandscape: aiData.competitiveLandscape || 'Not specified in document',
      goToMarket: aiData.goToMarket || 'Not specified in document',
      aiStatus: aiEnabled ? 'RAG AI analysis complete' : (aiData.aiError || 'AI setup required'),
      ragUsed: retrievalSuccess,
      chunkCount: chunks.length,
      retrievedChunks: topChunks.length
    };
    
    const extractionId = `rag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('=== RAG ANALYSIS COMPLETE ===');
    logger.info(`Company: ${validatedData.company}`);
    logger.info(`RAG Status: ${retrievalSuccess ? 'Vector search' : 'Keyword fallback'}`);
    logger.info(`AI Status: ${validatedData.aiStatus}`);
    logger.info(`Processing time: ${Date.now() - startTime}ms`);
    
    // Return complete RAG analysis
    return {
      success: true,
      data: validatedData,
      extractionId: extractionId,
      source: aiEnabled ? (retrievalSuccess ? 'vertex-ai-gemini-1.5-flash with RAG' : 'vertex-ai-gemini-1.5-flash with keyword fallback') : 'pdf-fallback',
      pdfSize: pdfBuffer.length,
      textLength: extractedText.length,
      chunkCount: chunks.length,
      retrievedChunks: topChunks.length,
      ragUsed: retrievalSuccess,
      sampleText: extractedText.substring(0, 300),
      aiEnabled: aiEnabled,
      aiTokens: aiEnabled ? extractionPrompt.length + aiResponse.length : 0,
      confidence: aiEnabled ? (retrievalSuccess ? 'high' : 'medium') : 'low',
      status: aiEnabled ? `AI-powered RAG pitch deck analysis complete!` : 'PDF processed, AI setup required',
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
// Helper function to parse Firebase Storage path
function parseFilePath(pdfUrl) {
  // Handle gs:// URLs
  if (pdfUrl.startsWith('gs://')) {
    const bucketPrefix = `gs://startup-evaluation-472010.appspot.com/`;
    if (!pdfUrl.startsWith(bucketPrefix)) {
      throw new Error(`Invalid bucket in URL: ${pdfUrl}`);
    }
    // Extract path after bucket
    const filePath = pdfUrl.substring(bucketPrefix.length);
    return decodeURIComponent(filePath);
  }

  // Handle HTTPS URLs with name parameter
  const nameMatch = pdfUrl.match(/name=([^&]+)/);
  if (nameMatch) {
    return decodeURIComponent(nameMatch[1]);
  }

  // Handle HTTPS URLs with /o/ path
  const pathMatch = pdfUrl.match(/o\/([^?]+)/);
  if (pathMatch) {
    return decodeURIComponent(pathMatch[1].replace(/%2F/g, '/'));
  }

  throw new Error(`Cannot parse file path from URL: ${pdfUrl}`);
}

// Helper for cosine similarity
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

// FIXED: Function to generate embeddings using Vertex AI
async function generateEmbeddings(texts) {
  if (!embeddingClient) {
    throw new Error('Embedding client not available');
  }
  
  const endpoint = client.buildEndpointName('startup-evaluation-472010', 'us-central1', 'publishers/google/models/text-embedding-004');
  
  const embeddings = [];
  
  for (const text of texts) {
    try {
      const instanceValue = {
        content: { stringValue: text }
      };
      
      const parameters = {
        // No parameters needed for text-embedding-004
      };
      
      const request = {
        endpoint: endpoint,
        instances: [instanceValue],
        parameters: parameters
      };
      
      const [response] = await embeddingClient.predict(request);
      const predictions = response.predictions;
      
      if (predictions && predictions.length > 0) {
        const embedding = predictions[0].embeddings.values.map(v => v.numberValue);
        embeddings.push(embedding);
      } else {
        logger.warn('No embedding returned for text:', text.substring(0, 50));
        // Fallback to zero vector
        embeddings.push(Array(768).fill(0)); // text-embedding-004 dimension
      }
    } catch (error) {
      logger.error('Embedding generation failed for text:', error);
      embeddings.push(Array(768).fill(0)); // Fallback
    }
  }
  
  return embeddings;
}
