const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const pdf = require("pdf-parse");
const retry = require("async-retry");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// Vertex AI imports
let vertexAIClient = null;
let vertexLoaded = false;

async function loadVertexAI() {
  if (vertexLoaded) return;
  try {
    const { VertexAI } = require("@google-cloud/vertexai");
    vertexAIClient = new VertexAI({
      project: "startup-evaluation-472010",
      location: "us-central1",
    });
    logger.info("Vertex AI SDK loaded successfully");
    vertexLoaded = true;
  } catch (importError) {
    logger.warn("Vertex AI SDK not available:", importError.message);
    vertexAIClient = null;
  }
}

// Helper function to parse Firebase Storage path
function parseFilePath(pdfUrl) {
  if (pdfUrl.startsWith("gs://")) {
    const bucketPrefix = `gs://startup-evaluation-472010.firebasestorage.app`;
    if (!pdfUrl.startsWith(bucketPrefix)) {
      throw new Error(`Invalid bucket in URL: ${pdfUrl}`);
    }
    const filePath = pdfUrl.substring(bucketPrefix.length);
    return decodeURIComponent(filePath);
  }
  const nameMatch = pdfUrl.match(/name=([^&]+)/);
  if (nameMatch) return decodeURIComponent(nameMatch[1]);
  const pathMatch = pdfUrl.match(/o\/([^?]+)/);
  if (pathMatch) return decodeURIComponent(pathMatch[1].replace(/%2F/g, "/"));
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

// Function to generate embeddings using Vertex AI
async function generateEmbeddings(texts) {
  if (!vertexAIClient) {
    throw new Error("Vertex AI client not available");
  }
  const model = vertexAIClient.getGenerativeModel({ model: "text-embedding-004" });
  const embeddings = [];
  for (const text of texts) {
    try {
      if (!text || text.trim().length === 0) {
        logger.warn("Empty text chunk, skipping:", text.substring(0, 50));
        embeddings.push(Array(768).fill(0));
        continue;
      }
      const request = { content: text };
      const result = await retry(
        async () => await model.generateContent(request),
        { retries: 3, minTimeout: 1000 }
      );
      const embedding = result.response.candidates[0].content.parts[0].embedding.values;
      embeddings.push(embedding || Array(768).fill(0));
    } catch (error) {
      logger.error("Embedding generation failed for text:", text.substring(0, 50), error.message);
      embeddings.push(Array(768).fill(0));
    }
  }
  return embeddings;
}

// Simple test function
exports.helloWorld = onCall({ memory: "256MB" }, async (request) => {
  await loadVertexAI();
  return {
    message: "Hello from Firebase Functions v2 with AI!",
    timestamp: new Date().toISOString(),
    aiAvailable: !!vertexAIClient,
  };
});

// Health check
exports.healthCheck = onCall({ memory: "256MB" }, async () => {
  await loadVertexAI();
  return {
    status: "healthy",
    timestamp: new Date().toISOString(),
    project: "startup-evaluation-472010",
    aiAvailable: !!vertexAIClient,
    services: {
      storage: "available",
      pdfParse: "working",
      vertexAI: vertexAIClient ? "ready" : "setup required",
      embeddings: !!vertexAIClient,
    },
  };
});

// Test storage access
exports.testStorageAccess = onCall({ memory: "256MB" }, async (request) => {
  try {
    const { pdfUrl } = request.data;
    if (!pdfUrl) return { success: false, error: "No PDF URL" };
    const filePath = parseFilePath(pdfUrl);
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) return { success: false, error: "File not found" };
    const [metadata] = await file.getMetadata();
    return {
      success: true,
      message: "Storage access confirmed",
      size: metadata.size,
      contentType: metadata.contentType,
    };
  } catch (error) {
    logger.error("Test storage failed:", error);
    return { success: false, error: error.message };
  }
});

// RAG-powered PDF processing
exports.processPitchDeck = onCall({ memory: "512MB", timeoutSeconds: 120 }, async (request) => {
  await loadVertexAI();
  const startTime = Date.now();
  logger.info("=== AI PITCH DECK RAG ANALYSIS START ===", {
    user: request.auth?.uid,
    pdfUrl: request.data?.pdfUrl,
  });

  try {
    const { pdfUrl } = request.data;
    if (!pdfUrl) throw new Error("PDF URL is required");

    // Step 1: Download PDF
    logger.info("Step 1: Downloading PDF...");
    const filePath = parseFilePath(pdfUrl);
    logger.info(`Processing file: ${filePath}`);
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) throw new Error(`PDF file not found: ${filePath}`);
    const [pdfBuffer] = await file.download();
    logger.info(`PDF downloaded successfully: ${pdfBuffer.length} bytes`);

    // Step 2: Extract text
    logger.info("Step 2: Extracting text with pdf-parse...");
    const pdfData = await pdf(pdfBuffer);
    const extractedText = pdfData.text
      .replace(/\s+/g, " ")
      .replace(/Page \d+/gi, "")
      .replace(/^\s*$\n/gm, "")
      .trim();
    logger.info(`Extracted ${extractedText.length} characters of text`);
    if (extractedText.length < 100) {
      throw new Error(`Document too short for analysis (${extractedText.length} chars)`);
    }

    // Step 3: RAG - Chunk text
    logger.info("Step 3: Starting RAG processing...");
    const chunkSize = 300;
    const chunks = [];
    for (let i = 0; i < extractedText.length; i += chunkSize) {
      chunks.push(extractedText.substring(i, i + chunkSize));
    }
    const validChunks = chunks.filter(chunk => chunk && chunk.trim().length > 0);
    if (validChunks.length === 0) {
      throw new Error("No valid text chunks for embedding");
    }
    logger.info(`Created ${validChunks.length} valid chunks`);

    // Step 4: Generate embeddings
    let chunkEmbeddings = [];
    let retrievalSuccess = false;
    if (vertexAIClient) {
      try {
        logger.info("Generating embeddings for chunks...");
        chunkEmbeddings = await generateEmbeddings(validChunks);
        logger.info("Chunk embeddings:", chunkEmbeddings.map(e => e.slice(0, 5)));
        retrievalSuccess = chunkEmbeddings.some(e => e.some(v => v !== 0));
        logger.info(`Generated embeddings for ${chunkEmbeddings.length} chunks`);
      } catch (error) {
        logger.warn("Embedding generation failed, using keyword search:", error.message);
        chunkEmbeddings = validChunks.map(() => null);
        retrievalSuccess = false;
      }
    } else {
      logger.warn("No Vertex AI client, using keyword search");
      retrievalSuccess = false;
    }

    // Step 5: Retrieve relevant chunks
    logger.info("Step 4: Retrieving relevant chunks...");
    const extractionQuery = "Extract key startup pitch deck information including company, value proposition, market size, traction, team, funding ask, use of funds, business model, competitive landscape, go-to-market strategy";
    let topChunks = [];
    if (retrievalSuccess && chunkEmbeddings.length > 0 && chunkEmbeddings[0]) {
      const queryEmbedding = await generateEmbeddings([extractionQuery]);
      logger.info("Query embedding:", queryEmbedding[0].slice(0, 5));
      const similarities = chunkEmbeddings.map((emb, idx) => ({
        index: idx,
        similarity: emb ? cosineSimilarity(queryEmbedding[0], emb) : 0,
      }));
      similarities.sort((a, b) => b.similarity - a.similarity);
      topChunks = similarities.slice(0, 5).map((s) => validChunks[s.index]);
      logger.info(`Retrieved top 5 chunks with similarity: ${similarities[0].similarity.toFixed(4)}`);
    } else {
      const keywords = ["company", "market", "traction", "team", "funding", "revenue", "customers", "growth", "business", "strategy", "competitive"];
      const chunkScores = validChunks.map((chunk, idx) => {
        let score = 0;
        keywords.forEach((keyword) => {
          if (chunk.toLowerCase().includes(keyword)) score += 1;
        });
        return { index: idx, score };
      });
      chunkScores.sort((a, b) => b.score - a.score);
      topChunks = chunkScores.slice(0, 5).map((s) => validChunks[s.index]);
      logger.info("Retrieved top 5 chunks using keyword matching");
    }

    // Step 6: Create augmented prompt
    logger.info("Step 5: Creating RAG-augmented prompt...");
    const augmentedContext = topChunks.join("\n\n---\n\n");
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

    // Step 7: AI Analysis with Vertex AI
    logger.info("Step 6: Starting AI analysis with RAG prompt...");
    let aiData = {
      company: "Document Analysis (AI Setup Required)",
      valueProposition: `Document contains ${extractedText.length} characters`,
      marketSize: "Not specified in document",
      traction: `Processed with ${validChunks.length} chunks`,
      team: "Not specified in document",
      fundingAsk: "Not specified in document",
      useOfFunds: "Not specified in document",
      businessModel: "Not specified in document",
      competitiveLandscape: "Not specified in document",
      goToMarket: "Not specified in document",
    };
    let aiEnabled = false;
    let aiResponse = "";
    if (vertexAIClient) {
      try {
        logger.info("Initializing Vertex AI Gemini 1.5 Flash...");
        const model = vertexAIClient.getGenerativeModel({
          model: "gemini-1.5-flash",
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        });
        logger.info("Model loaded, generating content...");
        const result = await retry(
          async () => await model.generateContent(extractionPrompt),
          { retries: 3, minTimeout: 1000 }
        );
        const candidates = result.response?.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error("No candidates returned from AI");
        }
        const parts = candidates[0].content?.parts;
        if (!parts || parts.length === 0) {
          throw new Error("No content parts returned from AI");
        }
        aiResponse = parts[0].text || "";
        if (!aiResponse) throw new Error("No text content returned from AI");
        logger.info(`AI Response (${aiResponse.length} chars):`, aiResponse.substring(0, 200));
        try {
          aiData = JSON.parse(aiResponse);
          logger.info("Direct JSON parsing successful");
        } catch (parseError) {
          logger.warn("Direct JSON failed, trying regex extraction");
          const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            aiData = JSON.parse(jsonMatch[0]);
            logger.info("Regex JSON extraction successful");
          } else {
            throw new Error(`Invalid AI response format: ${aiResponse.substring(0, 300)}`);
          }
        }
        aiEnabled = true;
        logger.info("AI Processing Complete");
      } catch (error) {
        logger.error("AI Processing Failed:", error.message);
        aiData.aiError = error.message.includes("permission")
          ? "Vertex AI permissions required - check IAM roles"
          : error.message.includes("API not enabled")
          ? "Vertex AI API needs to be enabled in Google Cloud Console"
          : error.message.includes("quota")
          ? "Vertex AI quota exceeded - check billing"
          : error.message.includes("model")
          ? "Model access required - enable Gemini in Vertex AI Studio"
          : error.message;
      }
    } else {
      logger.warn("Vertex AI client not available");
      aiData.aiError = "Vertex AI not configured";
    }

    // Step 8: Return results
    const validatedData = {
      company: aiData.company || "Document Analysis (AI Setup Required)",
      valueProposition: aiData.valueProposition || `Document contains ${extractedText.length} characters`,
      marketSize: aiData.marketSize || "Not specified in document",
      traction: aiData.traction || "Not specified in document",
      team: aiData.team || "Not specified in document",
      fundingAsk: aiData.fundingAsk || "Not specified in document",
      useOfFunds: aiData.useOfFunds || "Not specified in document",
      businessModel: aiData.businessModel || "Not specified in document",
      competitiveLandscape: aiData.competitiveLandscape || "Not specified in document",
      goToMarket: aiData.goToMarket || "Not specified in document",
      aiStatus: aiEnabled ? "RAG AI analysis complete" : (aiData.aiError || "AI setup required"),
      ragUsed: retrievalSuccess,
      chunkCount: validChunks.length,
      retrievedChunks: topChunks.length,
    };

    logger.info("=== RAG ANALYSIS COMPLETE ===");
    logger.info(`Company: ${validatedData.company}`);
    logger.info(`RAG Status: ${retrievalSuccess ? "Vector search" : "Keyword fallback"}`);
    logger.info(`AI Status: ${validatedData.aiStatus}`);
    logger.info(`Processing time: ${Date.now() - startTime}ms`);

    return {
      success: true,
      data: validatedData,
      extractionId: `rag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      source: aiEnabled ? (retrievalSuccess ? "vertex-ai-gemini-1.5-flash with RAG" : "vertex-ai-gemini-1.5-flash with keyword fallback") : "pdf-fallback",
      pdfSize: pdfBuffer.length,
      textLength: extractedText.length,
      chunkCount: validChunks.length,
      retrievedChunks: topChunks.length,
      ragUsed: retrievalSuccess,
      sampleText: extractedText.substring(0, 300),
      aiEnabled,
      aiTokens: aiEnabled ? extractionPrompt.length + (aiResponse.length || 0) : 0,
      confidence: aiEnabled ? (retrievalSuccess ? "high" : "medium") : "low",
      status: aiEnabled ? "AI-powered RAG pitch deck analysis complete!" : "PDF processed, AI setup required",
      processingTime: Date.now() - startTime,
      nextSteps: aiEnabled
        ? []
        : [
            "Enable Vertex AI API in Google Cloud Console",
            "Add 'Vertex AI User' role to service account in IAM",
            "Visit Vertex AI Studio to request Gemini model access",
            "Retry analysis to enable AI features",
          ],
    };
  } catch (error) {
    logger.error("=== PDF PROCESSING FAILED ===", { error: error.message, stack: error.stack });
    throw new Error(`Document processing failed: ${error.message}`);
  }
});
