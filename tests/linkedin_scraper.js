import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { loadCredentials } from '../utils/auth.js';
import researchKeywords from '../utils/keywords.js';

// Helper to get current file directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.resolve(__dirname, '../data/research_posts.json');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function postMatchesKeywords(text, keywords) {
  const lowered = text.toLowerCase();
  return keywords.some(keyword => lowered.includes(keyword.toLowerCase()));
}

async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const { username, password } = loadCredentials();
    console.log('✅ Credentials loaded');

    await page.goto('https://www.linkedin.com/login');
    await page.fill('input[name="session_key"]', username);
    await page.fill('input[name="session_password"]', password);
    
   await page.click('button[type="submit"]');

// ✅ Wait for a known post-login UI element
await page.waitForSelector('input[placeholder*="Search"]', { timeout: 10000 });

if (page.url().includes('/checkpoint')) {
  throw new Error('❌ Login checkpoint triggered.');
}

console.log('✅ Logged into LinkedIn');



    const query = 'research paper ai';
    await page.goto(`https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&origin=SWITCH_SEARCH_VERTICAL`);

    const results = [];
    const seen = new Set();

    for (let i = 0; i < 10; i++) {
      const posts = await page.$$('div.feed-shared-update-v2');

      for (const post of posts) {
        try {
          const content = await post.innerText();

          if (postMatchesKeywords(content, researchKeywords) && !seen.has(content)) {
            const timestamp = new Date().toISOString();
            results.push({ timestamp, content });
            seen.add(content);
            console.log(`📄 Match found:\n${content.slice(0, 100)}...\n---`);
          }
        } catch (err) {
          console.error('❌ Failed to read post:', err.message);
        }
      }

      await page.mouse.wheel(0, 3000);
      await delay(2000);
    }

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`✅ Saved ${results.length} matching posts to ${outputPath}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await browser.close();
  }
}

run();