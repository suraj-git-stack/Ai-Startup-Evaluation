# 🚀 AI Agent Lad: AI-Powered Startup Analysis

Welcome to **Startup Scout**, a web app built for a hackathon to streamline AI-driven startup evaluation and generate investment memorandums. Upload pitch decks, transcripts, or videos, and let our AI extract insights, pull digital footprints, and craft pro-level memos—all in one slick flow!

---

## ✨ Features

- **Smart Uploads**: Drop pitch decks (PDFs), call transcripts, videos, audio, or founder updates—Vertex AI extracts key data and stores it in Firestore.  
- **Digital Footprint Scanner**: Search companies to fetch real-time data from trusted APIs (e.g., Crunchbase, LinkedIn), blended into a clean overview.  
- **AI-Powered Q&A**: Ask founders questions via AI agent calls or emails, with responses refining your analysis automatically.  
- **Manual KPI Input**: Add custom metrics like revenue or growth, seamlessly integrated with AI insights.  
- **Investment Memo Generator**: AI combines deck data, web intel, and Q&A into a polished memorandum with recommendations and risks.  

---

## 🛠 Tech Stack

- **Frontend**: HTML, CSS, JavaScript — lightweight, responsive UI for smooth uploads and dashboards.  
- **Backend**: Firebase Cloud Functions — serverless power for file processing and API calls.  
- **AI & Data**: Google Vertex AI (Gemini model) for content extraction; Firestore for storage; Google Cloud Storage for uploads.  
- **Deployment**: Firebase Hosting for fast, one-click launches with built-in auth and real-time sync.  

---

## ⚙️ Setup Instructions

### 1. Clone the Repo
```bash
git clone https://github.com/your-username/startup-scout.git
cd startup-scout
```
## 2. Install Dependencies
```bash
npm install firebase @google-cloud/vertexai pdf-parse
```

## 3. Set Up Firebase

- Initialize a Firebase project:

```bash firebase init```


- Configure Firestore, Cloud Functions, and Storage in the Firebase Console.

Deploy:

```bash 
firebase deploy
 ```

## 4. Configure Google Cloud

- Enable Vertex AI API in Google Cloud Console.

- Set up a service account with Vertex AI User role.

- Add your Google Cloud project ID (e.g., startup-evaluation-472010) to functions/index.js.

## 5. Environment Variables

```bash 
firebase functions:config:set gcloud.project="your project id" gcloud.region="us-central1"

 ```

## 6. Run Locally

```bash 
firebase emulators:start

 ```
## 7. Deploy to Production

```bash 
firebase deploy --only hosting
firebase deploy --only functions
 ```
## 📌 Usage

- Upload Files: Use the web interface to upload pitch decks, videos, or transcripts (stored in Google Cloud Storage).

- Search Companies: Enter a company name to fetch digital footprints via APIs.

- Ask Questions: Use the AI agent to send emails or make calls to founders.

- Generate Memo: Click "Generate Analysis" to get a downloadable investment memorandum.

## 💰 Cost Estimate

- Build Cost: $0–$50 (Firebase Spark plan + $300 Google Cloud credits for Vertex AI).

- Monthly Run: ~$10 for light use; ~$20 for 100 decks/month (Vertex AI tokens + Firebase Blaze plan).

- Total MVP Cost: $10–$80 for hackathon-ready app.

## 🔮 Future Enhancements

- Add support for more file types (e.g., MP3, MP4).

- Integrate advanced analytics for traction and market size.

- PIpe call agent for clarification automation.
