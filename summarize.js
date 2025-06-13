import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';

config(); // Load .env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-4o';

// __dirname workaround for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load scraped posts
const rawPostsPath = path.resolve(__dirname, 'data/research_posts.json');
const outputPath = path.resolve(__dirname, 'data/research_summaries.json');

const posts = JSON.parse(fs.readFileSync(rawPostsPath, 'utf-8'));

async function summarize(text) {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are an expert research analyst. When given a LinkedIn post that talks about a research paper, technical concept, or industry trend, you generate a concise, professional, single-paragraph summary in 4–6 sentences. Make the summary detailed enough to capture the research context, main objectives, methodology, key findings, and any authors or contributors mentioned in the post. Add a small random note to make each summary unique. Seed: ${Math.random()}. Do not use bullet points. Do not copy text. Use your own words.`
      },
      {
        role: 'user',
        content: `Here is the LinkedIn post:\n\n${text}\n\nPlease summarize it in a single paragraph of 4–6 well-written sentences.`
      }
    ],
    temperature: 0.9,
    max_tokens: 800
  });

  return response.choices[0].message.content;
}

async function tagPost(summary) {
  const tagResponse = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `
You are a research assistant tasked with processing research papers and other documents. For each input, you must provide two distinct outputs:

1. **Summary:** Write a concise, professional summary of the document, approximately 800 characters long, structured into 2-3 paragraphs. Focus on the research context, key objectives, methodology, main findings, and any contributors or authors mentioned.

2. **Tags:** Provide 1-3 short, relevant tags derived from the document's content (e.g., RAG, LLMOps, Evaluation, Startup Strategy, AI Ethics). Return these tags as a comma-separated list.

Please provide the summary first, followed by the tags on a new line. Do not copy text from the original post; use your own words. Do not use bullet points.
`
      },
      {
        role: 'user',
        content: `Please tag this summary:\n\n"${summary}"`
      }
    ],
    temperature: 0,
    max_tokens: 30
  });

// console.log("Using prompt:", content);

  return tagResponse.choices[0].message.content
    .split(',')
    .map(tag => tag.trim());
}

const results = [];

for (const [i, post] of posts.entries()) {
       if (
       (!post.researchLinks || post.researchLinks.length === 0) &&
        (!post.links || post.links.length === 0)
    ) {
  // Skip posts without any research links or general links
      console.log(`⏭️ Skipping post ${i + 1}/${posts.length} — no links found.`);
     continue;
    }

    console.log(`🔍 Post ${i + 1}:`, {
  researchLinks: post.researchLinks,
  links: post.links
});

  console.log(`⏳ Summarizing post ${i + 1}/${posts.length}...`);

  try {
    const summary = await summarize(post.content);
    const tags = await tagPost(summary);

    const getSourceDomain = (url) => {
      if (!url) return "Unknown";
      if (url.includes("arxiv.org")) return "arXiv";
      if (url.includes("ssrn.com")) return "SSRN";
      if (url.includes("ieeexplore")) return "IEEE";
      if (url.includes("springer")) return "Springer";
      return "Other";
    };

    const paperSource = getSourceDomain(post.researchLinks[0]);

    results.push({
      ...post,
      summary,
      tags,
      sourceType: "research",
      paperSource
    });

    console.log(`✅ Summary: ${summary.slice(0, 80)}...`);
  } catch (err) {
    console.error(`❌ Failed to summarize post ${i + 1}:`, err.message);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`\n✨ Saved ${results.length} summarized posts to: ${outputPath}`);