# 🧠 InsightHarvester

**InsightHarvester** is an AI-powered pipeline that scrapes, summarizes, and tags research-related content from platforms like LinkedIn (and soon, others like arXiv, SSRN, Medium, etc.). It uses Playwright for scraping and OpenAI's GPT-4o for generating intelligent summaries and topic tags.

---

## ✨ Features

- 🔍 Scrapes research-related posts and links from LinkedIn
- 🤖 Summarizes content using GPT-4o (OpenAI API)
- 🏷️ Automatically tags posts by topic (e.g., RAG, LLMOps, Evaluation)
- 📂 Saves clean structured data to JSON
- 📊 Expandable to dashboards, email digests, PDF exports
- 🔧 Designed to scale to other sources (arXiv, Medium, etc.)

---

## 📁 Folder Structure

InsightHarvester/
├── data/                     # Scraped + summarized post storage
├── tests/                   # Playwright scraping scripts
│   └── linkedin_scraper.js
├── summarize.js             # GPT-powered summarizer + auto-tagger
├── .env                     # API keys (not committed)
├── .gitignore
├── package.json
└── README.md

---

## ⚙️ Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/your-username/InsightHarvester.git
   cd InsightHarvester

2. **Install dependencies**
   npm install
   
3. **Add your OpenAI key**
  # .env file
  OPENAI_API_KEY=sk-xxxxxx

4. **Run the scraper**
   node tests/linkedin_scraper.js

5. **Generate summaries and tags**
   node summarize.js

🛠️ **Coming Soon**
	•	Multi-platform scraping (arXiv, SSRN)
	•	Dashboard UI (React/Streamlit)
	•	Weekly summary email tool
	•	CSV / PDF export
	•	LangChain-powered Q&A assistant

 **Example Output**
 {
  "timestamp": "2025-05-28T12:05:22Z",
  "content": "Excited to share my latest paper on...",
  "summary": "This post introduces a new research paper focused on ...",
  "tags": ["RAG", "LLMOps", "Evaluation"],
  "links": ["https://arxiv.org/abs/2405.12345"]
}

**Author**
Built with 💡 by @Sunita Negi
Inspired by a real-world need to cut through research noise and extract usable insights.

**License**
MIT License – feel free to use, fork, and contribute!

  
