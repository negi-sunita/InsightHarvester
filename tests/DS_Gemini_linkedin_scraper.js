// linkedin_scraper.js
import { chromium } from 'playwright';  // This is the only Playwright import needed
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration - Set these in environment variables ---
const PROFILE_URLS = (process.env.LINKEDIN_PROFILE_URLS || "https://www.linkedin.com/in/harrison-chase-90737146/,https://www.linkedin.com/in/jim-fan/").split(',');
// Replace existing KEYWORDS_RAW line with:
const KEYWORDS_RAW = (process.env.LINKEDIN_KEYWORDS || "research paper,preprint,whitepaper,case study,technical report,arxiv,ssrn,ieee,springer,acm,pubmed,researchgate,doi.org,abstract,introduction,methodology,experimental results,systematic review,empirical study,we propose,this paper,findings").split(',');
const KEYWORDS = KEYWORDS_RAW.map(k => k.trim().toLowerCase()); // Normalize keywords upfront

// Add to configuration section (~line 20)
const RESEARCH_DOMAINS = [
  'arxiv.org', 'researchgate.net', 'ssrn.com', 
  'ieeexplore.ieee.org', 'springer.com', 'link.springer.com',
  'sciencedirect.com', 'pubmed.ncbi.nlm.nih.gov',
  'acm.org', 'doi.org', 'nature.com', 'science.org',
  'jstor.org', 'tandfonline.com', 'sci-hub.se'
];

// Replace existing RESEARCH_FILE_EXTS
const RESEARCH_FILE_EXTS = ['.pdf', '.docx', '.pptx', '.tex', '.epub'];

const MAX_SCROLL_ATTEMPTS = parseInt(process.env.MAX_SCROLL_ATTEMPTS || "10", 10);
const MIN_DELAY_SEC = parseFloat(process.env.MIN_DELAY_SEC || "2.5"); // Seconds
const MAX_DELAY_SEC = parseFloat(process.env.MAX_DELAY_SEC || "5.5"); // Seconds
const LOGIN_TIMEOUT_MS = parseInt(process.env.LOGIN_TIMEOUT_MS || "30000", 10); // Milliseconds
const NAVIGATION_TIMEOUT_MS = parseInt(process.env.NAVIGATION_TIMEOUT_MS || "60000", 10); // Milliseconds
const COOKIE_FILE = path.join(__dirname, "linkedin_cookies.json"); // Store cookies in the same directory

// --- More Specific Selectors (THESE WILL LIKELY NEED ADJUSTMENT) ---
// Inspect LinkedIn's HTML to find robust selectors. These are placeholders.
const LOGIN_USERNAME_SELECTOR = '#username';
const LOGIN_PASSWORD_SELECTOR = '#password';
const LOGIN_SUBMIT_BUTTON_SELECTOR = 'button[type="submit"]';
const LOGIN_SUCCESS_INDICATOR_SELECTOR = 'input[type="text"][placeholder*="Search"]'; // e.g., the main search bar
// For recent activity, the structure might be complex. This is a very optimistic example.
const PROFILE_POSTS_CONTAINER_SELECTOR = 'main section ul > li div[data-urn^="urn:li:activity:"], main section div[data-urn^="urn:li:share:"], main section div.feed-shared-update-v2'; // Example, needs heavy verification. Try to find a common wrapper for each post.
const POST_CONTENT_SELECTOR = '.feed-shared-update-v2__description .update-components-text, .update-components-text.break-words'; // Example for post text
const SEE_MORE_BUTTON_SELECTOR = 'button.see-more, button.feed-shared-inline-show-more-text__see-more-less-toggle'; // Example
// Permalinks are tricky. Often found in timestamps or share menus.
const POST_PERMALINK_SELECTOR_PATTERN = 'a[href*="urn:li:activity:"], a[href*="/feed/update/urn:li:activity:"]';
const NO_MORE_POSTS_INDICATOR_TEXT = "You've reached the end"; // This text can change

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function randomDelay(multiplier = 1.0) {
    const delayMs = (Math.random() * (MAX_DELAY_SEC - MIN_DELAY_SEC) + MIN_DELAY_SEC) * 1000 * multiplier;
    await sleep(delayMs);
}

async function humanLikeScroll(page, scrollsDoneTotal) {
    const baseScrollDistance = Math.floor(Math.random() * (800 - 400 + 1)) + 400;
    const scrollMultiplier = 1 + (scrollsDoneTotal / (MAX_SCROLL_ATTEMPTS * 2));
    let scrollDistance = Math.floor(baseScrollDistance * scrollMultiplier);

    for (let i = 0; i < (Math.floor(Math.random() * 3) + 1); i++) {
        await page.mouse.wheel(0, scrollDistance);
        await randomDelay(0.5);
        scrollDistance = Math.floor(scrollDistance * (Math.random() * (1.2 - 0.8) + 0.8));
    }
}

async function safeQuerySelector(element, selector) {
    try {
        return await element.$(selector);
    } catch (error) {
        // console.warn(`safeQuerySelector: Element for selector "${selector}" not found or error: ${error.message}`);
        return null;
    }
}

async function safeQuerySelectorAll(element, selector) {
    try {
        return await element.$$(selector);
    } catch (error) {
        // console.warn(`safeQuerySelectorAll: Elements for selector "${selector}" not found or error: ${error.message}`);
        return [];
    }
}

async function safeGetAttribute(elementHandle, attribute) {
    if (elementHandle) {
        try {
            return await elementHandle.getAttribute(attribute);
        } catch (error) {
            // console.warn(`safeGetAttribute: Could not get attribute "${attribute}": ${error.message}`);
            return null;
        }
    }
    return null;
}

async function safeInnerText(elementHandle) {
    if (elementHandle) {
        try {
            return await elementHandle.innerText();
        } catch (error) {
            // console.warn(`safeInnerText: Could not get inner text: ${error.message}`);
            return null;
        }
    }
    return null;
}

async function clickSeeMoreButtons(pageOrElement, selector) {
    const buttons = await safeQuerySelectorAll(pageOrElement, selector);
    let clickedAny = false;
    for (const button of buttons) {
        try {
            if (await button.isVisible()) {
                await button.click({ timeout: 5000 });
                await randomDelay(0.5); // Wait for content to expand
                clickedAny = true;
            }
        } catch (error) {
            // console.warn(`Could not click 'see more' button: ${error.message}`);
        }
    }
    return clickedAny;
}

async function extractPostData(postElement, profileBaseUrl) {

    let isResearchContent = false;
  const detectedSources = new Set();

  // Enhanced keyword detection
  const researchIndicators = [
    /(research\s*paper)/i,
    /(preprint)/i,
    /(peer-reviewed)/i,
    /(methodology)/i,
    /(empirical\s*study)/i,
    /(systematic\s*review)/i,
    /(we\s+propose)/i,
    /(this\s+paper)/i,
    /(experimental\s+results)/i,
    /(findings)/i,
    /(abstract:)/i,
    /(doi:\s*)/i
  ];

   if (KEYWORDS.some(keyword => textContentLower.includes(keyword)) {
    isResearchContent = true;
  }
  
  // Check 2: Regex patterns
  if (researchIndicators.some(regex => regex.test(textContent))) {
    isResearchContent = true;
  }

    await clickSeeMoreButtons(postElement, SEE_MORE_BUTTON_SELECTOR);

    const textElement = await safeQuerySelector(postElement, POST_CONTENT_SELECTOR);
    let textContent = await safeInnerText(textElement) || "";
    const textContentLower = textContent.toLowerCase();

    if (KEYWORDS.some(keyword => textContentLower.includes(keyword))) {
        const permalinkElements = await safeQuerySelectorAll(postElement, POST_PERMALINK_SELECTOR_PATTERN);
        let postUrl = null;

        for (const el of permalinkElements) {
            const href = await safeGetAttribute(el, 'href');
            for (const link of allLinks) {
  const href = await safeGetAttribute(link, 'href');
  if (!href) continue;

  // Conference/journal detection
  if (/proceedings|conference|journal|volume|issue


            if (href) {
                if (href.startsWith('/')) {
                    postUrl = `https://www.linkedin.com${href}`;
                } else if (href.startsWith('https://www.linkedin.com/')) {
                    postUrl = href;
                }
                 if (postUrl && postUrl.includes("urn:li:activity:")) { // Ensure it's a plausible activity link
                     break;
                } else {
                    postUrl = null; // Reset if not a good link
                }
            }
        }
        
        // If the above didn't work, look for a more generic link within the post time or similar common areas
        if (!postUrl) {
            const possibleLinks = await postElement.$$('a[href]'); // Get all links in the post
            for (const linkEl of possibleLinks) {
                const href = await linkEl.getAttribute('href');
                if (href && href.includes('/feed/update/urn:li:activity:')) {
                     if (href.startsWith('/')) {
                        postUrl = `https://www.linkedin.com${href}`;
                    } else {
                        postUrl = href;
                    }
                    break;
                }
            }
        }


        if (postUrl) {
            return { url: postUrl, text_snippet: textContent.substring(0, 200) };
        } else {
            console.log(`Keywords matched in post on ${profileBaseUrl}, but couldn't extract direct permalink. Text: ${textContent.substring(0, 100)}...`);
        }
    }
    return null;
}


async function extractPostsFromProfile(page, profileUrl) {
    console.log(`Processing profile: ${profileUrl}`);
    const activitySharesUrl = `${profileUrl.replace(/\/$/, '')}/recent-activity/shares/`; // More robustly form the URL
    try {
        await page.goto(activitySharesUrl, { timeout: NAVIGATION_TIMEOUT_MS });
        await randomDelay();
    } catch (error) {
        if (error.name === 'TimeoutError') {
            console.error(`Timeout loading profile page: ${activitySharesUrl}`);
        } else {
            console.error(`Error navigating to profile ${activitySharesUrl}: ${error.message}`);
        }
        return [];
    }

    const matchedPostsData = [];
    const processedPostUrls = new Set(); // To avoid processing duplicates by URL

    let previousPostsCount = 0;
    let stableScrolls = 0; // Count consecutive scrolls that yield no new posts

    for (let i = 0; i < MAX_SCROLL_ATTEMPTS; i++) {
        console.log(`Scroll attempt ${i + 1}/${MAX_SCROLL_ATTEMPTS} for ${profileUrl}`);
        await humanLikeScroll(page, i);
        await randomDelay(1); // Longer delay after a scroll batch

        const currentPostElements = await safeQuerySelectorAll(page, PROFILE_POSTS_CONTAINER_SELECTOR);

        if (currentPostElements.length === 0 && i === 0) {
            console.log(`No posts found on initial load for ${profileUrl}. Check selector: ${PROFILE_POSTS_CONTAINER_SELECTOR}`);
            // Try to see if there's any "no activity" message
            // const noActivity = await page.$('text=/No recent activity to show/i');
            // if (noActivity) console.log("Found 'No recent activity' message.");
            break;
        }
        
        if (currentPostElements.length === previousPostsCount) {
            stableScrolls++;
            if (stableScrolls >= 3) { // If 3 consecutive scrolls don't load new items
                 console.log("No new posts loaded after several scrolls, assuming end or issue.");
                 break;
            }
        } else {
            stableScrolls = 0; // Reset if new posts are found
        }
        previousPostsCount = currentPostElements.length;


        for (const postElement of currentPostElements) {
            if (Math.random() < 0.1) { // Random hover
                try {
                    await postElement.hover({ timeout: 3000 });
                    await randomDelay(0.2);
                } catch (e) { /* ignore hover errors */ }
            }

            const postData = await extractPostData(postElement, profileUrl);
            if (postData && !processedPostUrls.has(postData.url)) {
                matchedPostsData.push(postData);
                processedPostUrls.add(postData.url);
                console.log(`  Found matching post: ${postData.url}`);
            }
        }
        
        // Optional: Check for "No more posts" text explicitly
        try {
            const endIndicator = await page.locator(`text=/${NO_MORE_POSTS_INDICATOR_TEXT}/i`).first(); // Use first() to avoid error if multiple
            if (endIndicator && await endIndicator.isVisible({timeout: 1000})) { // Short timeout for visibility check
                console.log("Found 'no more posts' indicator.");
                break;
            }
        } catch (e) { /* Element likely not found, which is fine */ }


        await randomDelay(); // Pause between scroll batches
    }

    console.log(`Found ${matchedPostsData.length} matching posts for ${profileUrl}`);
    return matchedPostsData;
}

async function loadCookies(context) {
    try {
        if (require('fs').existsSync(COOKIE_FILE)) {
            const cookiesString = await fs.readFile(COOKIE_FILE);
            const cookies = JSON.parse(cookiesString);
            await context.addCookies(cookies);
            console.log("Loaded cookies from file.");
            return true;
        }
    } catch (error) {
        console.error(`Error loading cookies: ${error.message}`);
        // If cookies are corrupted, remove them
        try { await fs.unlink(COOKIE_FILE); console.log("Removed corrupted cookie file.");} catch (e) {}
    }
    return false;
}

async function saveCookies(context) {
    try {
        const cookies = await context.cookies();
        await fs.writeFile(COOKIE_FILE, JSON.stringify(cookies, null, 2));
        console.log("Saved cookies to file.");
    } catch (error) {
        console.error(`Error saving cookies: ${error.message}`);
    }
}

async function loginToLinkedIn(page, context) {
    await page.goto("https://www.linkedin.com/feed/", { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    await randomDelay();

    const isLoggedIn = await page.$(LOGIN_SUCCESS_INDICATOR_SELECTOR);
    if (isLoggedIn && await isLoggedIn.isVisible()) {
        console.log("Already logged in (possibly via cookies or existing session).");
        return;
    }
    
    if (await loadCookies(context)) {
        await page.reload({ timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
        await randomDelay();
        const isLoggedInAfterCookieLoad = await page.$(LOGIN_SUCCESS_INDICATOR_SELECTOR);
        if (isLoggedInAfterCookieLoad && await isLoggedInAfterCookieLoad.isVisible()) {
            console.log("Successfully logged in using cookies.");
            return;
        }
        console.log("Cookies loaded but login state not confirmed. Proceeding to credential login.");
    }


    console.log("Attempting login with credentials...");
    try {
        await page.goto("https://www.linkedin.com/login", { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
        await randomDelay();
    } catch (e) {
         console.error("Failed to navigate to login page, retrying...");
         await randomDelay(2);
         await page.goto("https://www.linkedin.com/login", { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
         await randomDelay();
    }


    const linkedinUser = process.env.LINKEDIN_USER;
    const linkedinPass = process.env.LINKEDIN_PASS;

    if (!linkedinUser || !linkedinPass) {
        throw new Error("LINKEDIN_USER and LINKEDIN_PASS environment variables are not set.");
    }

    try {
        await page.waitForSelector(LOGIN_USERNAME_SELECTOR, { timeout: 10000 });
        await page.fill(LOGIN_USERNAME_SELECTOR, linkedinUser);
        await randomDelay(0.5);
        await page.fill(LOGIN_PASSWORD_SELECTOR, linkedinPass);
        await randomDelay(0.5);

        const submitButton = await page.$(LOGIN_SUBMIT_BUTTON_SELECTOR);
        if (submitButton) {
            const boundingBox = await submitButton.boundingBox();
            if (boundingBox) {
                await page.mouse.move(
                    boundingBox.x + boundingBox.width / 2 + (Math.random() * 10 - 5),
                    boundingBox.y + boundingBox.height / 2 + (Math.random() * 10 - 5)
                );
            }
            await submitButton.click({ timeout: 10000 });
        } else {
            throw new Error("Login submit button not found.");
        }

        await page.waitForSelector(LOGIN_SUCCESS_INDICATOR_SELECTOR, { timeout: LOGIN_TIMEOUT_MS });
        console.log("Login successful.");
        await saveCookies(context);

    } catch (error) {
        const screenshotPath = path.join(__dirname, "login_failed_screenshot.png");
        try { await page.screenshot({ path: screenshotPath }); } catch (e) {console.error("Failed to take screenshot:", e)}
        if (error.name === 'TimeoutError') {
            throw new Error(`Login failed. Timeout waiting for success indicator or element. Check credentials, 2FA, or CAPTCHA. Screenshot: ${screenshotPath}`);
        }
        throw new Error(`An error occurred during login: ${error.message}. Screenshot: ${screenshotPath}`);
    }
}


async function main() {
    if (!process.env.LINKEDIN_USER || !process.env.LINKEDIN_PASS) {
        console.warn("Warning: LINKEDIN_USER and/or LINKEDIN_PASS environment variables are not set. Cookie-based login will be attempted first.");
    }

    let allFoundPostsData = [];
    const outputFilePath = path.join(__dirname, "found_linkedin_posts.txt");

    const browserArgs = [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--disable-notifications',
        '--disable-popup-blocking',
        // '--start-maximized' // Might be useful depending on OS/environment
    ];
    const proxyServer = process.env.PROXY_SERVER;
    const proxyUser = process.env.PROXY_USER;
    const proxyPass = process.env.PROXY_PASS;
    
    
    let proxySettings = undefined; // Instead of null
if (proxyServer) {
    proxySettings = { 
        server: proxyServer,
        ...(proxyUser && proxyPass && { 
            username: proxyUser,
            password: proxyPass
        })
    };
}

  const browser = await chromium.launch({
    headless: false,
    args: browserArgs,
    ...(proxySettings && { proxy: proxySettings }) // Only add proxy if configured
});

    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.82 Safari/537.36", // Keep UA relatively modern
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        locale: "en-US"
    });
    await context.grantPermissions(['notifications'], { origin: "https://www.linkedin.com" });

    const page = await context.newPage();

    try {
        await loginToLinkedIn(page, context);

        for (const profileUrl of PROFILE_URLS) {
            if (!profileUrl.trim()) continue;
            const postsData = await extractPostsFromProfile(page, profileUrl.trim());
            if (postsData) {
                for (const postItem of postsData) {
                    if (!allFoundPostsData.some(p => p.url === postItem.url)) {
                        allFoundPostsData.push(postItem);
                    }
                }
            }

            // Save progress incrementally
            let outputContent = "";
            for (const item of allFoundPostsData) {
                outputContent += `${item.url}\n`; //  Just URL, or more details: `${item.url} - Snippet: ${item.text_snippet}\n`
            }
            await fs.writeFile(outputFilePath, outputContent, "utf-8");
            
            console.log(`Total unique posts found so far: ${allFoundPostsData.length}`);

            if (PROFILE_URLS.length > 1 && profileUrl !== PROFILE_URLS[PROFILE_URLS.length - 1]) {
                console.log("Taking a longer break before next profile...");
                await randomDelay(Math.random() * (6 - 3) + 3); // Longer break
            }
        }
    } catch (error) {
        console.error(`An critical error occurred in main execution: ${error.message}`);
        const screenshotPath = path.join(__dirname, "critical_error_screenshot.png");
        try { await page.screenshot({ path: screenshotPath }); console.log(`Screenshot captured as ${screenshotPath}`);}
        catch(e) {console.error("Failed to take screenshot on critical error:", e)}
    } finally {
        console.log("Closing browser.");
        await browser.close();
    }

    console.log(`\n--- All Found Posts (${allFoundPostsData.length}) ---`);
    allFoundPostsData.forEach(item => {
        console.log(`URL: ${item.url}`);
        // console.log(`Snippet: ${item.text_snippet || 'N/A'}`);
    });
    console.log(`Results also saved to ${outputFilePath}`);
}

main().catch(err => {
    console.error("Unhandled error in main execution:", err);
    process.exit(1);
});
}
