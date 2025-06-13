import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { loadCredentials } from '../utils/auth.js';
import researchKeywords from '../utils/keywords.js';
import fetch from 'node-fetch';
import fs from 'fs/promises';

// Helper: Expand short links
async function resolveShortUrl(shortUrl) {
  try {
    const response = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'follow'
    });
    return response.url || shortUrl;
  } catch (err) {
    console.warn(`⚠️ Could not resolve: ${shortUrl}`);
    return shortUrl;
  }
}

// ESM-friendly __dirname
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
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  let context;
  let page;

  // Check if auth.json exists
  try {
    await fs.access('auth.json');
    console.log("✅ auth.json found — reusing session.");
    context = await browser.newContext({
      storageState: 'auth.json'
    });
    page = await context.newPage();
  } catch (err) {
    console.log("🔐 auth.json not found — manual login required.");
    context = await browser.newContext();
    page = await context.newPage();

    const { username, password } = loadCredentials();
    console.log('✅ Credentials loaded');

    await page.goto('https://www.linkedin.com/login');
    await page.fill('input[name="session_key"]', username);
    await page.fill('input[name="session_password"]', password);
    await page.click('button[type="submit"]');

    // Optional: CAPTCHA detection
    if (await page.locator('text=Verify').isVisible()) {
      console.log("🔐 CAPTCHA or puzzle detected — please solve it manually.");
      await page.pause(); // opens Playwright Inspector so you can interact
    } else {
      console.log("✅ Login form submitted.");
    }

    // Save session for next time
    await context.storageState({ path: 'auth.json' });
    console.log("✅ Saved login session to auth.json");
  }

  try {
    // Wait for the main feed or search bar to load
    await page.waitForSelector('//input[@placeholder="Search"]', { timeout: 15000 });
    if (page.url().includes('/checkpoint')) {
      throw new Error('❌ Login checkpoint triggered.');
    }
    console.log('✅ Logged into LinkedIn');

    const content = await page.content();
console.log(content);

    // Search
    const query = 'research paper ai';
    await page.goto(`https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&origin=SWITCH_SEARCH_VERTICAL`);

    const results = [];
    const seen = new Set();

    for (let i = 0; i < 10; i++) {
      const posts = await page.$$('div.feed-shared-update-v2');

      for (const post of posts) {
        try {
          const content = await post.innerText();

          // Extract and expand all hyperlinks
          const linkHandles = await post.$$('a');
          const links = [];
          for (const linkHandle of linkHandles) {
            const href = await linkHandle.getAttribute('href');
            if (href && href.startsWith('http')) {
              const expanded = await resolveShortUrl(href);
              links.push(expanded);
            }
          }

          const researchLinks = links.filter(link =>
            link.includes('arxiv.org') ||
            link.includes('ssrn.com') ||
            link.includes('ieeexplore') ||
            link.includes('springer')
          );

          if (postMatchesKeywords(content, researchKeywords) && !seen.has(content)) {
            results.push({
              timestamp: new Date().toISOString(),
              content,
              links,
              researchLinks
            });
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

    await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
    console.log(`✅ Saved ${results.length} matching posts to ${outputPath}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await browser.close();
  }
}

run();