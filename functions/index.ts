import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

// Import Admin SDK
import admin from "firebase-admin";

// Import Vertex AI
import { VertexAI } from '@google-cloud/vertexai';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

// Initialize Vertex AI with error handling
let generativeModel = null;
let vertexAI = null;

async function initializeVertexAI() {
  if (generativeModel) {
    return generativeModel;
  }
  
  try {
    logger.info('Initializing Vertex AI...');
    
    vertexAI = new VertexAI({
      project: 'startup-evaluation-472010',
      location: 'us-central1',
    });
    
    // Valid model versions for Vertex AI (updated order for better success rate)
    const modelVersions = [
      'gemini-1.5-flash',      // Most stable and accessible
      'gemini-1.5-pro',        // Pro version if available
      'gemini-1.0-pro-vision', // Vision-enabled
      'text-bison@001',        // Legacy with version
      'gemini-pro'             // Simple Pro fallback
    ];
    
    let model;
    for (const version of modelVersions) {
      try {
        logger.info(`Trying model version: ${version}`);
        model = vertexAI.getGenerativeModel({ 
          model: version,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        });
        
        // Test the model with a simple request
        const testResult = await model.generateContent('Say "test"');
        logger.info(`✅ Model ${version} works! Test response: ${testResult.response.text().substring(0, 50)}`);
        generativeModel = model;
        return model;
        
      } catch (versionError) {
        logger.warn(`❌ Model ${version} failed:`, versionError.message);
        continue; // Try next version
      }
    }
    
    throw new Error('All Vertex AI model versions failed - check API access and permissions');
    
  } catch (error) {
    logger.error('Failed to initialize Vertex AI:', error);
    throw new Error(`Vertex AI initialization failed: ${error.message}`);
  }
}

const prompt = `Analyze this pitch deck PDF and extract the following information as a valid JSON object. 
Only return JSON, no additional text:

{
  "company": "Company name",
  "valueProposition": "Core value proposition in 1-2 sentences",
  "marketSize": "Market size (TAM/SAM/SOM) and growth potential",
  "traction": "Key traction metrics, customers, revenue, partnerships",
  "team": "Key team members and their relevant experience",
  "fundingAsk": "Amount of funding requested and valuation",
  "useOfFunds": "How the funds will be used",
  "businessModel": "Revenue model and pricing strategy",
  "competitiveLandscape": "Main competitors and differentiation",
  "goToMarket": "Customer acquisition strategy"
}

If any field is not found or unclear, use "Not specified in pitch deck".`;

// Temporary Storage Access Test Function
export const testStorageAccess = onCall(async (request) => {
  try {
    const { pdfUrl } = request.data;
    
    if (!pdfUrl) {
      throw new Error('No PDF URL provided for testing');
    }
    
    logger.info('=== STORAGE ACCESS TEST START ===');
    logger.info('Testing URL:', pdfUrl);
    
    // Parse URL with multiple methods
    let filePath;
    const urlMatch = pdfUrl.match(/name=([^&]+)/);
    if (urlMatch) {
      filePath = decodeURIComponent(urlMatch[1]);
      logger.info('Method 1 - name= param: SUCCESS');
    } else {
      const altMatch = pdfUrl.match(/o\/([^?]+)/);
      if (altMatch) {
        const encodedPath = altMatch[1];
        filePath = decodeURIComponent(encodedPath.replace(/%2F/g, '/'));
        logger.info('Method 2 - o/ path: SUCCESS');
      } else {
        throw new Error('Invalid URL format - neither name= nor o/ path found');
      }
    }
    
    logger.info('Parsed file path:', filePath);
    
    const bucket = admin.storage().bucket();
    logger.info('Bucket name:', bucket.name);
    
    const file = bucket.file(filePath);
    logger.info('File reference created:', file.name);
    
    // Test 1: Basic exists check
    logger.info('Test 1: Checking file exists...');
    const [exists] = await file.exists();
    logger.info('Exists check raw response:', JSON.stringify(exists));
    logger.info('File exists:', exists[0]);
    
    // Test 2: Get metadata
    logger.info('Test 2: Getting file metadata...');
    const [metadata] = await file.getMetadata();
    logger.info('Metadata retrieved:', {
      name: metadata.name,
      size: metadata.size,
      timeCreated: metadata.timeCreated,
      contentType: metadata.contentType,
      bucket: metadata.bucket
    });
    
    // Test 3: Try download first few bytes
    logger.info('Test 3: Downloading first 10 bytes...');
    const [buffer] = await file.download({ start: 0, end: 10 });
    const header = buffer.toString('utf8', 0, 4);
    logger.info('First 10 bytes (hex):', buffer.toString('hex'));
    logger.info('PDF header check:', header);
    
    return {
      success: true,
      filePath: filePath,
      exists: exists[0],
      size: metadata.size,
      contentType: metadata.contentType,
      bucket: metadata.bucket,
      pdfHeader: header,
      testsPassed: ['exists', 'metadata', 'download']
    };
    
  } catch (error) {
    logger.error('=== STORAGE ACCESS TEST FAILED ===');
    logger.error('Error message:', error.message);
    logger.error('Error code:', error.code);
    logger.error('Full error:', error);
    
    return {
      success: false,
      error: error.message,
      filePath: filePath || 'not-parsed',
      testsPassed: []
    };
  }
});

// Simple health check function
export const healthCheck = onCall(async (request) => {
  try {
    logger.info('Health check called');
    return { 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      project: 'startup-evaluation-472010'
    };
  } catch (error) {
    logger.error('Health check failed:', error);
    throw new Error('Health check failed');
  }
});

// Simple Vertex AI test function
export const testVertexAIOnly = onCall(async (request) => {
  try {
    logger.info('=== VERTEX AI ONLY TEST ===');
    
    const vertexAI = new VertexAI({
      project: 'startup-evaluation-472010',
      location: 'us-central1',
    });
    
    const model = vertexAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: { temperature: 0.1 }
    });
    
    const result = await model.generateContent('Hello, test Vertex AI access');
    const response = result.response.text();
    
    logger.info('✅ Vertex AI test SUCCESS:', response.substring(0, 50));
    
    return { success: true, response: response };
  } catch (error) {
    logger.error('❌ Vertex AI test FAILED:', error.message);
    return { success: false, error: error.message };
  }
});

// Main Pitch Deck Processing Function with ALL Fixes
export const processPitchDeck = onCall(
  { 
    memory: '2GiB',
    timeoutSeconds: 540,
    cpu: 1,
    concurrency: 1,
    maxInstances: 3,
    region: 'us-central1'
  },
  async (request) => {
    // CRITICAL FIX: Declare variables at FUNCTION SCOPE to prevent ReferenceError
    let filePath = 'NOT_EXTRACTED';
    let pdfHeader = 'unknown';
    let pdfBuffer = null;
    
    logger.info('=== PITCH DECK PROCESSING START ===');
    
    // Log request details for debugging
    logger.info('Request data:', JSON.stringify(request.data));
    logger.info('Request auth exists:', !!request.auth);
    if (request.auth) {
      logger.info('Request auth UID:', request.auth.uid);
    }
    
    // Enhanced authentication check
    if (!request.auth) {
      logger.error('NO AUTHENTICATION PROVIDED');
      throw new Error('Must be authenticated. Please sign in again.');
    }

    const { pdfUrl } = request.data;
    if (!pdfUrl) {
      logger.error('NO PDF URL PROVIDED');
      throw new Error('pdfUrl required.');
    }

    logger.info('PDF URL received:', pdfUrl);

    try {
      // STEP 1: Enhanced URL parsing with multiple methods
      logger.info('STEP 1: Parsing PDF URL...');
      
      // Method 1: Traditional name= parameter
      const urlMatch = pdfUrl.match(/name=([^&]+)/);
      if (urlMatch) {
        filePath = decodeURIComponent(urlMatch[1]);
        logger.info('URL parsing method 1 (name=) successful');
      } else {
        // Method 2: Newer o/ path format
        const altMatch = pdfUrl.match(/o\/([^?]+)/);
        if (altMatch) {
          const encodedPath = altMatch[1];
          filePath = decodeURIComponent(encodedPath.replace(/%2F/g, '/'));
          logger.info('URL parsing method 2 (o/) successful');
        } else {
          // Method 3: Fallback - extract path from full URL
          logger.info('Trying fallback URL parsing...');
          const pathMatch = pdfUrl.match(/\/o\/([^?]+)\?alt=media/);
          if (pathMatch) {
            const encodedPath = pathMatch[1];
            filePath = decodeURIComponent(encodedPath.replace(/%2F/g, '/'));
            logger.info('URL parsing method 3 (fallback) successful');
          } else {
            logger.error('ALL URL PARSING METHODS FAILED');
            logger.error('Full URL:', pdfUrl);
            throw new Error('Invalid Firebase Storage URL format - could not extract file path');
          }
        }
      }
      
      logger.info('✅ Extracted file path:', filePath);
      
      // STEP 2: Access Storage bucket
      logger.info('STEP 2: Accessing Storage bucket...');
      const bucket = admin.storage().bucket();
      logger.info('Bucket name:', bucket.name);
      
      const file = bucket.file(filePath);
      logger.info('File reference created:', file.name);
      
      // STEP 3: Enhanced file existence check
      logger.info('STEP 3: Checking file existence with multiple methods...');
      let fileExists = false;
      
      try {
        // Method 1: Standard exists check
        const [exists] = await file.exists();
        logger.info('exists() raw response:', JSON.stringify(exists));
        fileExists = Boolean(exists[0]); // FIX: Convert to boolean
        logger.info('Method 1 - exists() result:', fileExists);
      } catch (existsError) {
        logger.warn('Method 1 (exists()) failed:', existsError.message);
      }
      
      if (!fileExists) {
        // Method 2: Try getMetadata
        try {
          logger.info('Method 2: Trying getMetadata...');
          const [metadata] = await file.getMetadata();
          logger.info('Method 2 - getMetadata succeeded');
          fileExists = true;
          logger.info('File metadata:', {
            name: metadata.name,
            size: metadata.size,
            contentType: metadata.contentType
          });
        } catch (metadataError) {
          logger.warn('Method 2 (getMetadata) failed:', metadataError.message);
        }
      }
      
      if (!fileExists) {
        // Method 3: Try download with error catching
        try {
          logger.info('Method 3: Trying download...');
          const [buffer] = await file.download({ start: 0, end: 0 });
          logger.info('Method 3 - download succeeded (empty range)');
          fileExists = true;
        } catch (downloadError) {
          logger.warn('Method 3 (download) failed:', downloadError.message);
        }
      }
      
      if (!fileExists) {
        logger.error('ALL FILE EXISTENCE CHECKS FAILED');
        logger.error('File path:', filePath);
        logger.error('Bucket:', bucket.name);
        throw new Error('PDF file not found in storage - all access methods failed');
      }
      
      logger.info('✅ File confirmed to exist via multiple methods');

      // STEP 4: Download the complete PDF
      logger.info('STEP 4: Downloading complete PDF...');
      pdfBuffer = await file.download(); // FIX: Remove destructuring to avoid issues
      const bufferLength = pdfBuffer ? pdfBuffer.length : 0;
      logger.info('✅ PDF downloaded successfully, size:', bufferLength, 'bytes');
      
      // Verify it's a PDF
      if (!pdfBuffer || bufferLength === 0) {
        throw new Error('PDF download returned empty buffer');
      }
      
      pdfHeader = pdfBuffer.toString('utf8', 0, 4);
      logger.info('PDF header verification:', pdfHeader);
      
      if (!pdfHeader.startsWith('%PDF')) {
        logger.error('FILE IS NOT A VALID PDF');
        logger.error('Header found:', pdfHeader);
        logger.error('First 20 bytes (hex):', pdfBuffer.toString('hex', 0, 20));
        throw new Error('File is not a valid PDF - invalid header');
      }

      logger.info('✅ File verified as valid PDF');

      // STEP 5: Initialize Vertex AI
      logger.info('STEP 5: Initializing Vertex AI...');
      const model = await initializeVertexAI();
      logger.info('✅ Vertex AI model initialized successfully');
      
      // STEP 6: Convert PDF to base64
      logger.info('STEP 6: Converting PDF to base64...');
      const base64PDF = pdfBuffer.toString('base64');
      logger.info('✅ PDF converted to base64, size:', base64PDF.length, 'characters');
      
      // STEP 7: Prepare Vertex AI request
      logger.info('STEP 7: Preparing Vertex AI request payload...');
      const requestPayload = {
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { 
              inlineData: { 
                mimeType: 'application/pdf', 
                data: base64PDF 
              } 
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      };

      logger.info('✅ Request payload prepared');

      // STEP 8: Send request to Vertex AI
      logger.info('STEP 8: Sending request to Vertex AI...');
      const result = await model.generateContent(requestPayload);
      logger.info('✅ Vertex AI response received successfully');
      
      if (!result.response || !result.response.candidates?.[0]) {
        logger.error('NO VALID RESPONSE FROM VERTEX AI');
        logger.error('Full result:', JSON.stringify(result));
        throw new Error('Failed to process PDF with AI model - no valid response');
      }

      const responseText = result.response.candidates[0].content.parts[0].text;
      logger.info('Vertex AI response length:', responseText.length);
      logger.info('Response preview:', responseText.substring(0, 200));
      
      // STEP 9: Parse JSON response
      logger.info('STEP 9: Parsing JSON response...');
      let extractedData;
      try {
        extractedData = JSON.parse(responseText);
        logger.info('✅ JSON parsed successfully, keys:', Object.keys(extractedData));
      } catch (parseError) {
        logger.error('INITIAL JSON PARSE ERROR:', parseError.message);
        logger.error('Raw response:', responseText);
        
        // Fallback: Try to extract JSON from response if it's wrapped in text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            extractedData = JSON.parse(jsonMatch[0]);
            logger.info('✅ Fallback JSON parsing successful');
          } catch (fallbackError) {
            logger.error('FALLBACK JSON PARSE FAILED:', fallbackError.message);
            throw new Error('Failed to parse AI response as JSON - both methods failed');
          }
        } else {
          logger.error('NO JSON STRUCTURE FOUND IN RESPONSE');
          throw new Error('Failed to parse AI response as JSON - no JSON structure found');
        }
      }

      // Validate extracted data structure
      logger.info('STEP 10: Validating extracted data structure...');
      const requiredKeys = ['company', 'valueProposition', 'marketSize', 'traction', 'team', 'fundingAsk', 'useOfFunds'];
      const missingKeys = requiredKeys.filter(key => !extractedData.hasOwnProperty(key));
      
      if (missingKeys.length > 0) {
        logger.warn('Missing required keys in extraction:', missingKeys);
        // Fill missing keys with defaults
        missingKeys.forEach(key => {
          extractedData[key] = 'Not specified in pitch deck';
        });
      }

      // STEP 11: Save to Firestore
      logger.info('STEP 11: Saving extraction results to Firestore...');
      const uid = request.auth.uid;
      const extractionDocRef = admin.firestore()
        .collection('users')
        .doc(uid)
        .collection('extractions')
        .doc(`pitchDeck_${Date.now()}`);

      await extractionDocRef.set({
        extracted: extractedData,
        originalPdfUrl: pdfUrl,
        filePath: filePath,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        userId: uid,
        fileSize: bufferLength,
        extractionKeys: Object.keys(extractedData),
        missingKeys: missingKeys
      });

      logger.info(`✅ Extraction saved successfully, ID: ${extractionDocRef.id}`);

      logger.info('=== PITCH DECK PROCESSING COMPLETED SUCCESSFULLY ===');

      return {
        success: true,
        extractionId: extractionDocRef.id,
        data: extractedData,
        processingTime: Date.now(),
        fileSize: bufferLength
      };

    } catch (error) {
      // CRITICAL FIX: Variables are now always defined - NO ReferenceError
      logger.error('=== CRITICAL ERROR IN PITCH DECK PROCESSING ===');
      logger.error('Error message:', error.message);
      logger.error('Error code:', error.code);
      logger.error('Error stack:', error.stack);
      logger.error('PDF URL:', pdfUrl);
      logger.error('File path:', filePath);
      logger.error('PDF header:', pdfHeader);
      logger.error('Buffer size:', pdfBuffer ? pdfBuffer.length : 'null');
      
      // Enhanced error mapping with better categorization
      let errorCode = 'internal';
      let errorMessage = 'Failed to process pitch deck';
      let details = error.message;
      
      // FIXED: Better error classification
      if (error.message.includes('not found') && (error.message.includes('storage') || error.message.includes('file'))) {
        errorCode = 'not-found';
        errorMessage = 'PDF file not found in storage';
        details = `File path: ${filePath}`;
      } else if (error.message.includes('404') || error.message.includes('model') || error.message.includes('gemini')) {
        errorCode = 'internal';
        errorMessage = 'AI model access error';
        details = `Vertex AI model not available: ${error.message}. Permissions may need time to propagate (5-15 minutes).`;
      } else if (error.message.includes('invalid') || error.message.includes('PDF')) {
        errorCode = 'invalid-argument';
        errorMessage = 'Invalid PDF file format';
        details = `Header: ${pdfHeader}, Size: ${pdfBuffer ? pdfBuffer.length : 'unknown'}`;
      } else if (error.message.includes('timeout') || error.message.includes('deadline')) {
        errorCode = 'deadline-exceeded';
        errorMessage = 'Processing timeout';
        details = 'The PDF may be too large or complex for the current timeout.';
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        errorCode = 'resource-exhausted';
        errorMessage = 'Processing quota exceeded';
        details = 'Vertex AI or Storage quota limits reached.';
      } else if (error.message.includes('permission') || error.message.includes('auth')) {
        errorCode = 'permission-denied';
        errorMessage = 'Permission denied';
        details = 'Check Storage rules and Vertex AI API permissions.';
      } else if (error.message.includes('JSON')) {
        errorCode = 'internal';
        errorMessage = 'Failed to parse AI response';
        details = 'Vertex AI returned invalid JSON format.';
      }
      
      logger.error(`Final error classification: ${errorCode} - ${errorMessage}`);
      logger.error(`Error details: ${details}`);
      
      // Throw structured error for client
      const err = new Error(`${errorMessage}: ${details}`);
      err.code = errorCode;
      throw err;
    }
  }
);