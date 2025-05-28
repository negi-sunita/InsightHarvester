import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';

config(); // Load .env
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// __dirname workaround for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load scraped posts
const rawPostsPath = path.resolve(__dirname, 'data/research_posts.json');
const outputPath = path.resolve(__dirname, 'data/research_summaries.json');

const posts = JSON.parse(fs.readFileSync(rawPostsPath, 'utf-8'));

async function summarize(text) {
  
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    {
      role: 'system',
      content: `You are an expert research analyst. When given a LinkedIn post that talks about a research paper, technical concept, or industry trend, you generate a concise, professional, single-paragraph summary in 4–6 sentences. Do not use bullet points. Do not copy text. Use your own words.`
    },
    {
      role: 'user',
      content: `Here is the LinkedIn post:\n\n${text}\n\nPlease summarize it in a single paragraph of 4–6 well-written sentences.`
    }
  ],
  temperature: 0.3,
  max_tokens: 400
});


  return response.choices[0].message.content;
}

async function tagPost(summary) {
  const tagResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a tagging assistant. Given a summary of a research-related post, return 1–3 short, relevant tags (like RAG, LLMOps, Evaluation, Startup Strategy, etc.). Return them as a comma-separated list.'
      },
      {
        role: 'user',
        content: `Please tag this summary:\n\n"${summary}"`
      }
    ],
    temperature: 0,
    max_tokens: 30
  });

  return tagResponse.choices[0].message.content
    .split(',')
    .map(tag => tag.trim());
}

const results = [];

for (let i = 0; i < posts.length; i++) {
  const post = posts[i];
  console.log(`⏳ Summarizing post ${i + 1}/${posts.length}...`);

  
  
  try {
   
   const summary = await summarize(post.content);
    const tags = await tagPost(summary);

    results.push({
    ...post,
    summary,
    tags
    });

    console.log(`✅ Summary: ${summary.slice(0, 80)}...`);
  } catch (err) {
    console.error(`❌ Failed to summarize post ${i + 1}:`, err.message);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`\n✨ Saved ${results.length} summarized posts to: ${outputPath}`);