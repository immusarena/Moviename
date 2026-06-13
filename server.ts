import express from 'express';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
import path from 'path';
import { Readable } from 'stream';
import https from 'https';
import http from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Ensure the Kali Linux sunset banner exists locally for static serving & github preservation
async function downloadKaliBanner() {
  const filePath = path.join(process.cwd(), 'kali_banner.jpg');
  if (fs.existsSync(filePath)) {
    console.log('[KaliBanner] Already exists locally. Ready for static serve.');
    return;
  }
  
  console.log('[KaliBanner] Downloading official Kali eclipse dragon wallpaper...');
  const imageUrl = 'https://images.wallpapersden.com/image/download/kali-linux-red-logo_bWlpZ2uUmZqaraWkpJRmbmdlrWZlbWY.jpg';
  
  try {
     const res = await fetch(imageUrl);
     if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
        console.log('[KaliBanner] Downloaded and saved wallpaper:', filePath);
     } else {
        console.warn('[KaliBanner] Direct fetch response was not ok:', res.statusText);
     }
  } catch (error) {
     console.error('[KaliBanner] Error downloading static banner:', error);
  }
}

// Spark background task to fetch local static image
downloadKaliBanner();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize server-side Gemini client
const apiKey = process.env.GEMINI_API_KEY || '';
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// REST endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', firebaseProject: 'moviename-26960' });
});

// GET endpoint: fetch telegram sticker set metadata
app.get('/api/telegram-stickers', async (req, res) => {
  const { pack, token } = req.query;
  
  if (!pack || typeof pack !== 'string') {
    res.status(400).json({ error: 'Telegram sticker pack name is required' });
    return;
  }

  // Use token passed from user, or falls back to server env token, or a sample working token
  const botToken = (token && typeof token === 'string' && token.trim()) 
    || process.env.TELEGRAM_BOT_TOKEN 
    || '7845347201:AAGy4F_WlPlIeR7fXn_Vv0gA9FmD_pQ6R8A'; // Sample token prefilled in system

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getStickerSet?name=${pack}`);
    const data = await response.json() as any;

    if (!data.ok) {
       res.status(400).json({ 
         error: data.description || 'Failed to retrieve pack from Telegram. Verify pack name and Bot Token.' 
       });
       return;
    }

    const title = data.result.title || data.result.name;
    const stickers = data.result.stickers.map((stk: any, idx: number) => {
       return {
          name: `${title} #${idx + 1}`,
          // Proxy path to download the actual image bytes lazily on demand
          url: `/api/telegram-file?token=${encodeURIComponent(botToken)}&file_id=${encodeURIComponent(stk.file_id)}`,
          emoji: stk.emoji || '✨',
          width: stk.width,
          height: stk.height,
          isVideo: stk.is_video || false,
          isAnimated: stk.is_animated || false
       };
    });

    res.json({
       success: true,
       title: title,
       name: data.result.name,
       stickersCount: stickers.length,
       stickers: stickers
    });
  } catch (error: any) {
    console.error('[TelegramStickers] Error loading pack details:', error);
    res.status(500).json({ error: `Backend service error: ${error.message}` });
  }
});

// GET endpoint: Proxy and download the actual sticker file
app.get('/api/telegram-file', async (req, res) => {
   const { token, file_id } = req.query;
   if (!file_id || typeof file_id !== 'string') {
      res.status(400).send('file_id is required');
      return;
   }

   const botToken = (token && typeof token === 'string' && token.trim()) 
     || process.env.TELEGRAM_BOT_TOKEN 
     || '7845347201:AAGy4F_WlPlIeR7fXn_Vv0gA9FmD_pQ6R8A';

   try {
      // 1. Get file path from Telegram using file_id
      const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${file_id}`);
      const fileInfo = await fileInfoRes.json() as any;

      if (!fileInfo.ok || !fileInfo.result?.file_path) {
         res.status(400).send('Could not fetch file info from Telegram.');
         return;
      }

      const filePath = fileInfo.result.file_path;
      const fileDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

      // 2. Stream the file content directly back with appropriate content headers
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'image/webp';
      if (ext === '.png') contentType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      if (ext === '.tgs') contentType = 'application/json'; // Handle animated Lottie files as JSON text
      if (ext === '.webm') contentType = 'video/webm';
      if (ext === '.mp4') contentType = 'video/mp4';

      const fileRes = await fetch(fileDownloadUrl);
      if (!fileRes.ok) {
         res.status(fileRes.status).send('Failed downloading sticker asset from Telegram.');
         return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      res.setHeader('Access-Control-Allow-Origin', '*');

      const arrayBuffer = await fileRes.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
   } catch (error: any) {
      console.error('[TelegramFile] Proxy download failed:', error);
      res.status(500).send(`Proxy download error: ${error.message}`);
   }
});

// Post endpoint: generate fun, non-spoilery AI hints for movie guessing
app.post('/api/ai-hint', async (req, res) => {
  const { movieName, tamilName } = req.body;
  if (!movieName) {
    res.status(400).json({ error: 'Movie name is required' });
    return;
  }

  if (!ai) {
    res.json({ hint: `A famous Tamil film often referred as: "${movieName.slice(0, 2)}..."` });
    return;
  }

  try {
    const prompt = `You are the master game host of a fun Tamil-English movie guessing web app called IMMU'S HUB.
The current secret movie is: "${movieName}" ${tamilName ? `(Tamil title: "${tamilName}")` : ''}.
Generate a single-sentence playful, witty, and cryptic hint or riddle (in clean English) for this movie without spoiling its exact name!
Keep it hilarious and tailored for friends. Do not repeat the movie name inside your answer under any circumstances. Keep response under 15 words.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    res.json({ hint: response.text?.trim() || `Clue matches the film: "${movieName.slice(0, 2)}..."` });
  } catch (error) {
    console.error('Gemini error:', error);
    res.json({ hint: `Popular movie consisting of ${movieName.length} letters.` });
  }
});

// Proxy route for streaming MP4 videos with range requests under our own domain to bypass CORS/hotlinking
app.get('/api/proxy-mp4', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    res.status(400).send('URL parameter is required');
    return;
  }

  let targetUrl = '';
  try {
    targetUrl = decodeURIComponent(url);
    console.log(`[ProxyMP4] Native proxying to: ${targetUrl}`);

    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const requester = isHttps ? https : http;

    const clientHeaders: Record<string, string> = {
      'User-Agent': m_getRandomUserAgent(),
      'Accept': '*/*',
    };

    if (req.headers.range) {
      clientHeaders['Range'] = req.headers.range as string;
    }

    const requestOptions: https.RequestOptions = {
      method: 'GET',
      headers: clientHeaders,
      rejectUnauthorized: false, // Prevents certificate handshake errors on stream proxies
      timeout: 12000,
    };

    const proxyReq = requester.request(targetUrl, requestOptions, (proxyRes) => {
      res.status(proxyRes.statusCode || 200);

      const headersToCopy = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'cache-control',
        'expires',
      ];

      for (const header of headersToCopy) {
        const val = proxyRes.headers[header];
        if (val) {
          res.setHeader(header, val);
        }
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', '*');

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err: any) => {
      console.log(`[ProxyMP4] Native proxy connection issue (${err.code || 'unreachable'}): ${err.message}`);
      if (!res.headersSent) {
        if (targetUrl.startsWith('http')) {
          console.log(`[ProxyMP4] Redirecting directly to avoid network blocks: ${targetUrl}`);
          res.redirect(targetUrl);
        } else {
          res.status(500).send(`Streaming failed: ${err.message}`);
        }
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });

    proxyReq.end();
  } catch (error: any) {
    console.error('[ProxyMP4] Streaming initialization error:', error.message);
    if (!res.headersSent) {
      if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
        res.redirect(targetUrl);
      } else {
        res.status(500).send(`Streaming failed: ${error.message}`);
      }
    }
  }
});

// Post endpoint: extract direct playable MP4 URL from an Instagram Reel or post URL
app.post('/api/extract-video', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      res.status(400).json({ success: false, error: 'URL is required' });
      return;
    }

    // Normalize the input URL (ensure it has a protocol)
    let targetUrlStr = url.trim();
    if (!/^https?:\/\//i.test(targetUrlStr)) {
      targetUrlStr = 'https://' + targetUrlStr;
    }

    // Check if it's an Instagram URL
    const isInstagram = /instagram\.com|instagr\.am/i.test(targetUrlStr);
    if (!isInstagram) {
      res.status(400).json({ success: false, error: 'Only Instagram URLs are supported' });
      return;
    }

    let videoUrl: string | null = null;
    let title: string | null = null;
    let lastError: any = null;

    // STRATEGY 1: Direct browser-like crawl of InDown.io (User requested method)
    try {
      console.log(`[Extractor] Attempting primary extraction via InDown for: ${targetUrlStr}`);
      const indownResult = await m_extractFromInDown(targetUrlStr);
      if (indownResult && indownResult.videoUrl) {
        videoUrl = indownResult.videoUrl;
        title = indownResult.title;
        console.log(`[Extractor] Successfully extracted video stream via InDown!`);
      }
    } catch (err: any) {
      console.log(`[Extractor] InDown extraction warning: ${err.message}`);
    }

    // STRATEGY 2: Public Cobalt instances (optimized for v7/v8/v9/v10 and highly robust failover)
    if (!videoUrl) {
      console.log(`[Extractor] Falling back to robust Cobalt federation instances to solve target link...`);
      const cobaltInstances = [
      'https://api.cobalt.tools',
      'https://cobalt.api.ryb.red',
      'https://co.wuk.sh',
      'https://cobalt.nay.su',
      'https://cobalt.moe',
      'https://cobalt.k6.cx',
      'https://cobalt.perv.cat',
      'https://api.underfy.me',
      'https://co.v9.su',
      'https://cobalt.sh',
      'https://cobalt.hot.ch',
      'https://cobalt.awand.co',
      'https://cobalt.casa',
      'https://cobalt.im',
      'https://cobalt.press'
    ];

    for (const instance of cobaltInstances) {
      // Try both standard v10 root endpoint and v7/v8/v9 "/api/json" path for full coverage
      const endpointsCandidate = [
        instance.endsWith('/') ? `${instance}api/json` : `${instance}/api/json`,
        instance
      ];

      for (const endpoint of endpointsCandidate) {
        try {
          console.log(`[Extractor] Querying endpoint: ${endpoint} for URL: ${targetUrlStr}`);
          const parsedUrl = new URL(endpoint);
          const originHeader = `${parsedUrl.protocol}//${parsedUrl.host}`;

          // Make the POST request with modern compatible payload containing only standard supported properties
          const cobaltResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': m_getRandomUserAgent(),
              'Origin': originHeader,
              'Referer': originHeader + '/'
            },
            body: JSON.stringify({
              url: targetUrlStr,
              videoQuality: '720'
            })
          });

          if (cobaltResponse.ok) {
            const contentType = cobaltResponse.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const data = await cobaltResponse.json() as any;
              console.log(`[Extractor] Success payload from ${endpoint}`);
              if (data && data.url) {
                videoUrl = data.url;
                title = data.text || data.filename || 'Instagram Video';
                break;
              } else if (data && data.picker && data.picker[0] && data.picker[0].url) {
                videoUrl = data.picker[0].url;
                title = data.text || 'Instagram Post';
                break;
              }
            } else {
              console.log(`[Extractor] Non-JSON payload from ${endpoint}: ${await cobaltResponse.text()}`);
            }
          } else {
            console.log(`[Extractor] Failed status ${cobaltResponse.status} from ${endpoint}`);
            // If the failure status indicates rate limits, authorization, or bad request, try with absolute minimal payload
            if (cobaltResponse.status === 403 || cobaltResponse.status === 401 || cobaltResponse.status === 400) {
              console.log(`[Extractor] Retrying ${endpoint} with absolute minimal payload...`);
              const retryResponse = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'User-Agent': m_getRandomUserAgent(),
                  'Origin': originHeader,
                  'Referer': originHeader + '/'
                },
                body: JSON.stringify({
                  url: targetUrlStr
                })
              });
              if (retryResponse.ok) {
                const retryData = await retryResponse.json() as any;
                if (retryData && retryData.url) {
                  videoUrl = retryData.url;
                  title = retryData.text || retryData.filename || 'Instagram Video';
                  break;
                } else if (retryData && retryData.picker && retryData.picker[0] && retryData.picker[0].url) {
                  videoUrl = retryData.picker[0].url;
                  title = retryData.text || 'Instagram Post';
                  break;
                }
              }
            }
          }
        } catch (err: any) {
          console.log(`[Extractor] Warning for ${endpoint}: ${err.message}`);
          lastError = err;
        }
      }

      if (videoUrl) {
        break; // Stop querying other nodes if videoUrl is successfully extracted
      }
    }
  }

    if (videoUrl) {
      res.json({
        success: true,
        url: videoUrl.startsWith('http') ? `/api/proxy-mp4?url=${encodeURIComponent(videoUrl)}` : videoUrl,
        title: title || 'Instagram Video Post',
        isEmbed: false
      });
    } else {
      console.log(`[Extractor] Extraction failure for Instagram URL: ${targetUrlStr}`);
      res.status(500).json({
        success: false,
        error: lastError ? `Extraction failed across all provider nodes: ${lastError.message}` : 'All active media nodes are busy or currently rate-limited by Meta. Please retry in a few seconds.'
      });
    }
  } catch (err: any) {
    console.error('Unhandled error in extract-video handler:', err);
    res.json({
      success: false,
      error: `Internal server error: ${err.message || 'unknown error'}`
    });
  }
});

function getInstagramEmbedUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const match = rawUrl.match(/(?:instagram\.com|instagr\.am|ddinstagram\.com|rxddinst\.com)\/(?:p|reel|tv)\/([a-zA-Z0-9_\-]+)/i);
    if (match && match[1]) {
      return `https://www.instagram.com/reel/${match[1]}/embed`;
    }
  } catch (e) {
    console.error('Error parsing instagram url for embed:', e);
  }
  return rawUrl;
}

function m_getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

async function m_extractFromInDown(targetUrlStr: string): Promise<{ videoUrl: string; title: string } | null> {
  try {
    console.log(`[InDown] Extraction initiated for URL: ${targetUrlStr}`);
    const userAgent = m_getRandomUserAgent();
    
    // 1. Visit the home page / en1 to get CSRF token and session cookies
    const initResponse = await fetch('https://indown.io/en1', {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!initResponse.ok) {
      console.log(`[InDown] Failed to fetch initial page: ${initResponse.status}`);
      return null;
    }

    const html = await initResponse.text();
    
    // Extract CSRF token from input name="_token" or meta csrf-token
    const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/) || 
                       html.match(/value="([^"]+)"\s+name="_token"/) ||
                       html.match(/content="([^"]+)"\s+name="csrf-token"/i) ||
                       html.match(/name="csrf-token"\s+content="([^"]+)"/i);
                       
    const csrfToken = tokenMatch ? tokenMatch[1] : null;
    if (!csrfToken) {
      console.log('[InDown] CSRFToken not found in initial HTML.');
      return null;
    }

    console.log(`[InDown] Retrieved CSRF Token: ${csrfToken}`);

    // Extract cookies safely supporting both getSetCookie and standard cookies parsing
    let setCookies: string[] = [];
    if (typeof initResponse.headers.getSetCookie === 'function') {
      setCookies = initResponse.headers.getSetCookie();
    } else {
      const rawCookie = initResponse.headers.get('set-cookie');
      if (rawCookie) {
        setCookies = [rawCookie];
      }
    }
    
    const cookieHeader = setCookies
      .map(c => c.split(';')[0])
      .filter(Boolean)
      .join('; ');

    // 2. Perform the POST submission to indown.io/download
    const formParams = new URLSearchParams();
    formParams.append('link', targetUrlStr);
    formParams.append('referer', 'https://indown.io/en1');
    formParams.append('locale', 'en');
    formParams.append('_token', csrfToken);

    const postHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://indown.io',
      'Referer': 'https://indown.io/en1'
    };

    if (cookieHeader) {
      postHeaders['Cookie'] = cookieHeader;
    }

    const postResponse = await fetch('https://indown.io/download', {
      method: 'POST',
      headers: postHeaders,
      body: formParams.toString()
    });

    if (!postResponse.ok) {
      console.log(`[InDown] POST download submission failed with status: ${postResponse.status}`);
      return null;
    }

    const resultHtml = await postResponse.text();

    // 3. Scan the HTML for direct video media links, button links, or elements
    const candidates: { href: string; text: string; score: number }[] = [];

    // Strategy A: Scan for anchor links
    const aTagRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = aTagRegex.exec(resultHtml)) !== null) {
      const href = match[1];
      const text = match[2].toLowerCase();
      
      // Filter candidates to ignore static pages
      if (href.startsWith('/') || (href.includes('indown.io') && !href.includes('proxy') && !href.includes('download'))) {
        continue;
      }
      if (href.includes('privacy-policy') || href.includes('contact') || href.includes('instagram.com/accounts')) {
        continue;
      }

      let score = 0;
      if (href.includes('cdninstagram.com') || href.includes('fbcdn.net')) {
        score += 100;
      }
      if (href.includes('.mp4')) {
        score += 50;
      }
      if (href.includes('video') || href.includes('media')) {
        score += 20;
      }
      if (text.includes('download') || text.includes('video') || text.includes('high quality')) {
        score += 30;
      }
      if (href.includes('force_download') || href.includes('download=')) {
        score += 40;
      }

      if (score > 0) {
        candidates.push({ href, text, score });
      }
    }

    // Strategy B: Scan for HTML5 video elements source tags
    const videoSrcRegex = /<video[^>]*src="([^"]+)"/gi;
    while ((match = videoSrcRegex.exec(resultHtml)) !== null) {
      const href = match[1];
      if (href && !href.startsWith('/')) {
        candidates.push({ href, text: 'video source', score: 120 });
      }
    }

    const sourceSrcRegex = /<source[^>]*src="([^"]+)"/gi;
    while ((match = sourceSrcRegex.exec(resultHtml)) !== null) {
      const href = match[1];
      if (href && !href.startsWith('/')) {
        candidates.push({ href, text: 'source parameter', score: 110 });
      }
    }

    // Sort by descending score
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      // Clean HTML entities from parsed URL
      const finalUrl = candidates[0].href
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      
      console.log(`[InDown] Extraction Success! Target parsed: ${finalUrl} (Score: ${candidates[0].score})`);
      return {
        videoUrl: finalUrl,
        title: 'Instagram Video'
      };
    }

    console.log('[InDown] No download links found in response HTML.');
    return null;
  } catch (error: any) {
    console.error(`[InDown] Extraction aborted under exception: ${error.message}`);
    return null;
  }
}

// Configure Vite or Static production assets and Socket.io Game orchestration
async function startServer() {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Serve static game pages and code assets
  app.use('/client', express.static(path.join(process.cwd(), 'client')));
  app.use('/src', express.static(path.join(process.cwd(), 'src')));
  app.use('/scenes', express.static(path.join(process.cwd(), 'scenes')));
  app.use('/objects', express.static(path.join(process.cwd(), 'objects')));
  app.use('/ui', express.static(path.join(process.cwd(), 'ui')));

  // Socket.io co-op game rooms structure
  const rooms = new Map();
  const CUSTOMER_NAMES = [
    'Emma Watson', 'John Legend', 'Keanu Reeves', 'Sundance Kid', 'Clint Eastwood',
    'Margot Robbie', 'Brad Pitt', 'Lady Gaga', 'David Bowie', 'Bob Marley',
    'Billie Eilish', 'Taylor Swift', 'Pedro Pascal', 'Ryan Gosling', 'Selena Gomez'
  ];
  const RECIPES = {
    espresso: ['beans', 'brew'],
    americano: ['beans', 'brew', 'hotwater'],
    latte: ['beans', 'brew', 'milk'],
    cappuccino: ['beans', 'brew', 'milkfoam'],
    mocha: ['beans', 'brew', 'chocolate', 'milk']
  };

  const generateRoomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected gameplay: ${socket.id}`);

    socket.on('createRoom', (data) => {
      let code = generateRoomCode();
      while (rooms.has(code)) {
        code = generateRoomCode();
      }
      const newRoom = {
        code,
        players: [{
          id: 'p1_' + Math.floor(Math.random() * 100),
          socketId: socket.id,
          name: data.name || 'HOST',
          role: '',
          ready: false
        }],
        gameState: {
          score: 0,
          running: false,
          timer: 300,
          orders: [],
          servedCount: 0,
          angryDeportCount: 0,
          pickupCounter: {},
          orderIndexCounter: 0
        }
      };
      rooms.set(code, newRoom);
      socket.join(code);
      socket.emit('roomCreated', { code, players: newRoom.players });
    });

    socket.on('joinRoom', (data) => {
      const code = data.code.toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        socket.emit('roomError', 'Room not found.');
        return;
      }
      if (room.players.length >= 2) {
        socket.emit('roomError', 'Room is currently full.');
        return;
      }
      const newPlayer = {
        id: 'p2_' + Math.floor(Math.random() * 100),
        socketId: socket.id,
        name: data.name || 'GUEST',
        role: '',
        ready: false
      };
      room.players.push(newPlayer);
      socket.join(code);
      io.to(code).emit('roomJoined', { code, players: room.players });
    });

    const checkRoomAndStart = (room) => {
      const cashier = room.players.find(p => p.role === 'cashier');
      const barista = room.players.find(p => p.role === 'barista');
      
      if (cashier && barista && !room.gameState.running) {
        room.players.forEach(p => p.ready = true);
        room.gameState.running = true;
        room.gameState.score = 0;
        room.gameState.timer = 300;
        room.gameState.orders = [];
        room.gameState.servedCount = 0;
        room.gameState.angryDeportCount = 0;
        room.gameState.pickupCounter = {};
        room.gameState.orderIndexCounter = 0;

        io.to(room.code).emit('startGame', {
          players: room.players,
          gameState: room.gameState
        });

        // immediately spawn first customer
        const drinks = Object.keys(RECIPES);
        const randomDrink = drinks[Math.floor(Math.random() * drinks.length)];
        const randomName = CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
        room.gameState.orderIndexCounter += 1;
        const firstOrder = {
          id: 'ord_' + room.gameState.orderIndexCounter,
          name: randomName,
          drink: randomDrink,
          patienceMax: 60,
          patience: 60,
          queueIndex: 0
        };
        room.gameState.orders.push(firstOrder);
        io.to(room.code).emit('newOrder', firstOrder);

        const ticker = setInterval(() => {
          if (!room.gameState.running || !rooms.has(room.code)) {
            clearInterval(ticker);
            return;
          }
          room.gameState.timer -= 1;

          // Update standing customer patience level meters
          for (let i = room.gameState.orders.length - 1; i >= 0; i--) {
            const o = room.gameState.orders[i];
            o.patience -= 1;
            if (o.patience <= 0) {
              room.gameState.score = Math.max(0, room.gameState.score - 50);
              room.gameState.angryDeportCount += 1;
              io.to(room.code).emit('customerLeaves', { orderId: o.id, happy: false });
              room.gameState.orders.splice(i, 1);
              io.to(room.code).emit('scoreUpdate', { score: room.gameState.score, type: 'angry_leave' });
            }
          }

          room.gameState.orders.forEach((o, idx) => { o.queueIndex = idx; });

          io.to(room.code).emit('tick', {
            timer: room.gameState.timer,
            orders: room.gameState.orders
          });

          if (room.gameState.timer % 15 === 0 && room.gameState.orders.length < 4 && Math.random() < 0.7) {
            const d = drinks[Math.floor(Math.random() * drinks.length)];
            const n = CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
            room.gameState.orderIndexCounter += 1;
            const nextOrder = {
              id: 'ord_' + room.gameState.orderIndexCounter,
              name: n,
              drink: d,
              patienceMax: Math.max(30, 60 - Math.floor(room.gameState.score / 500) * 5),
              patience: Math.max(30, 60 - Math.floor(room.gameState.score / 500) * 5),
              queueIndex: room.gameState.orders.length
            };
            room.gameState.orders.push(nextOrder);
            io.to(room.code).emit('newOrder', nextOrder);
          }

          if (room.gameState.timer <= 0) {
            room.gameState.running = false;
            io.to(room.code).emit('gameOver', {
              score: room.gameState.score,
              servedCount: room.gameState.servedCount,
              angryDeportCount: room.gameState.angryDeportCount
            });
            clearInterval(ticker);
          }
        }, 1000);
      }
    };

    const syncMocksAndLobby = (room) => {
      // Clear out previous mock players
      room.players = room.players.filter(p => !p.isMock);

      const cashier = room.players.find(p => p.role === 'cashier');
      const barista = room.players.find(p => p.role === 'barista');

      // Autofill other workspace slot as mock partner for instant playtesting!
      if (cashier && !barista) {
        room.players.push({
          id: 'mock_p2',
          socketId: 'mock_barista',
          name: 'SAPPII',
          role: 'barista',
          ready: true,
          isMock: true
        });
      } else if (barista && !cashier) {
        room.players.push({
          id: 'mock_p1',
          socketId: 'mock_cashier',
          name: 'IMMU',
          role: 'cashier',
          ready: true,
          isMock: true
        });
      }
    };

    socket.on('joinCoopLobby', (data) => {
      const code = 'COOP';
      let room = rooms.get(code);
      if (!room) {
        room = {
          code,
          players: [],
          gameState: {
            score: 0,
            running: false,
            timer: 300,
            orders: [],
            servedCount: 0,
            angryDeportCount: 0,
            pickupCounter: {},
            orderIndexCounter: 0
          }
        };
        rooms.set(code, room);
      }

      // Filter out stale socket registrations, or same name to allow clean reconnects
      room.players = room.players.filter((p) => p.name !== data.name.toUpperCase() && p.socketId !== socket.id);

      const newPlayer = {
        id: data.name.toUpperCase() === 'IMMU' ? 'p1' : (data.name.toUpperCase() === 'SAPPII' ? 'p2' : 'p_' + Math.floor(Math.random() * 105)),
        socketId: socket.id,
        name: data.name.toUpperCase(),
        role: data.role || '',
        ready: data.role ? true : false
      };

      room.players.push(newPlayer);
      syncMocksAndLobby(room); // Sync mock partners under the hood

      socket.join(code);

      io.to(code).emit('lobbyUpdate', { players: room.players });
      socket.emit('roomJoined', { code, players: room.players });
      io.to(code).emit('newLobbyMessage', { sender: 'SYSTEM', msg: `${newPlayer.name} joined as ${newPlayer.role ? newPlayer.role.toUpperCase() : 'UNDEFINED'}` });
      
      checkRoomAndStart(room);
    });

    socket.on('selectRole', (data) => {
      let room = null;
      for (const r of rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) { room = r; break; }
      }
      if (!room) return;
      // Filter out mock players so we can take their slot
      room.players = room.players.filter(p => !p.isMock);

      const isTaken = room.players.find(p => p.role === data.role && p.socketId !== socket.id);
      if (isTaken) {
        socket.emit('roomError', 'This job role is already taken by your co-op partner!');
        syncMocksAndLobby(room); // Restore mocks
        return;
      }
      const me = room.players.find(p => p.socketId === socket.id);
      if (me) {
        me.role = data.role;
        me.ready = true;
        syncMocksAndLobby(room); // Sync mock partners under the hood
        io.to(room.code).emit('lobbyUpdate', { players: room.players });
        checkRoomAndStart(room);
      }
    });

    socket.on('toggleReady', () => {
      let room = null;
      for (const r of rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) { room = r; break; }
      }
      if (!room) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (me) {
        if (!me.role) {
          socket.emit('roomError', 'Please select a job role (Cashier/Barista) before setting ready!');
          return;
        }
        me.ready = !me.ready;
        io.to(room.code).emit('lobbyUpdate', { players: room.players });
        checkRoomAndStart(room);
      }
    });

    socket.on('lobbyMessage', (data) => {
      let room = null;
      for (const r of rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) { room = r; break; }
      }
      if (!room) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (me) {
        io.to(room.code).emit('newLobbyMessage', { sender: me.name.toUpperCase(), msg: data.msg });
      }
    });

    socket.on('playerMove', (data) => {
      let room = null;
      for (const r of rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) { room = r; break; }
      }
      if (!room) return;
      socket.to(room.code).emit('playerMove', {
        socketId: socket.id,
        x: data.x,
        y: data.y,
        isWalking: data.isWalking,
        facingDir: data.facingDir
      });
    });

    socket.on('dropToCounter', (data) => {
      let room = null;
      for (const r of rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) { room = r; break; }
      }
      if (!room) return;
      const { slotId, ingredients } = data;
      const sortedMixed = [...ingredients].sort();
      let drinkMade = null;
      for (const [key, formula] of Object.entries(RECIPES)) {
        const sortedFormula = [...formula].sort();
        if (sortedMixed.length === sortedFormula.length && sortedFormula.every((v, i) => v === sortedMixed[i])) {
          drinkMade = key;
          break;
        }
      }
      if (!drinkMade) {
        socket.emit('roomError', 'Invalid recipe ingredients mix inside the brew pitcher!');
        return;
      }
      room.gameState.pickupCounter[slotId] = drinkMade;
      io.to(room.code).emit('pickupUpdated', {
        pickupCounter: room.gameState.pickupCounter,
        initiator: socket.id,
        action: 'dropped'
      });
    });

    socket.on('pickFromCounter', (data) => {
      let room = null;
      for (const r of rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) { room = r; break; }
      }
      if (!room) return;
      const { slotId } = data;
      const item = room.gameState.pickupCounter[slotId];
      if (!item) return;
      delete room.gameState.pickupCounter[slotId];
      io.to(room.code).emit('pickupUpdated', {
        pickupCounter: room.gameState.pickupCounter,
        initiator: socket.id,
        drinkType: item,
        action: 'picked'
      });
    });

    socket.on('deliverDrink', (data) => {
      let room = null;
      for (const r of rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) { room = r; break; }
      }
      if (!room) return;
      const delivered = data.drink.toLowerCase();
      if (room.gameState.orders.length === 0) {
        socket.emit('roomError', 'There are no active customer tickets waiting right now!');
        return;
      }
      const matchedIdx = room.gameState.orders.findIndex(ord => ord.drink.toLowerCase() === delivered);
      if (matchedIdx !== -1) {
        const ord = room.gameState.orders[matchedIdx];
        const satisfactionBonus = Math.floor((ord.patience / ord.patienceMax) * 50);
        room.gameState.score += (100 + satisfactionBonus);
        room.gameState.servedCount += 1;
        io.to(room.code).emit('customerLeaves', { orderId: ord.id, happy: true });
        room.gameState.orders.splice(matchedIdx, 1);
        io.to(room.code).emit('scoreUpdate', { score: room.gameState.score, bonus: satisfactionBonus, type: 'delivered' });
      } else {
        room.gameState.score = Math.max(0, room.gameState.score - 25);
        io.to(room.code).emit('scoreUpdate', { score: room.gameState.score, type: 'trash' });
      }
      room.gameState.orders.forEach((o, index) => { o.queueIndex = index; });
    });

    const leaveLobbyHandler = () => {
      for (const [code, r] of rooms.entries()) {
        const idx = r.players.findIndex(p => p.socketId === socket.id);
        if (idx !== -1) {
          const departed = r.players.splice(idx, 1)[0];
          if (r.players.length === 0) {
            rooms.delete(code);
          } else {
            io.to(code).emit('lobbyUpdate', { players: r.players });
            io.to(code).emit('newLobbyMessage', { sender: 'SYSTEM', msg: `${departed.name} left the game lobby.` });
            if (r.gameState.running) {
              r.gameState.running = false;
              io.to(code).emit('gameOver', {
                score: r.gameState.score,
                servedCount: r.gameState.servedCount,
                angryDeportCount: r.gameState.angryDeportCount
              });
            }
          }
          break;
        }
      }
    };

    socket.on('leaveRoom', leaveLobbyHandler);
    socket.on('disconnect', leaveLobbyHandler);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`COOPERATIVE RUSH SERVER RUNNING AT http://localhost:${PORT}`);
  });
}

startServer();
