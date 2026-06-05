import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

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

// Configure Vite or Static production assets
async function startServer() {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IMMU SERVER RUNNING AT http://localhost:${PORT}`);
  });
}

startServer();
