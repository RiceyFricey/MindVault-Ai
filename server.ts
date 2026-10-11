import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

// Helper to initialize GoogleGenAI instance safely with telemetry header
function getAI() {
  // Use environment variable first, falling back to your provided API key[cite: 2]
  const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyAXd-7NIYfnJZ0DiZpn6CbTncFfa9pBbCw';
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in the server environment. Please configure it in your Secrets panel or provide a key.');
  }
  
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Resilient Gemini generateContent caller with current model fallbacks and optional preferred model support[cite: 2]
async function generateContentWithFallback(ai: GoogleGenAI, params: { contents: string | any[]; config?: any; }, preferredModel?: string) {
  let models = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  if (preferredModel) {
    models = [preferredModel, ...models.filter(m => m !== preferredModel)];
  }
  let lastError = null;

  for (const model of models) {
    try {
      return await ai.models.generateContent({
        ...params,
        model,
      });
    } catch (err: any) {
      lastError = err;
      console.warn(`[MindVault AI] Model ${model} encountered error: ${err?.message || err}. Attempting fallback...`);
      // Short delay before fallback retry
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastError;
}

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasKey: Boolean(process.env.GEMINI_API_KEY || 'AIzaSyAXd-7NIYfnJZ0DiZpn6CbTncFfa9pBbCw'),
    time: new Date().toISOString(),
  });
});

// 2. Summarize Note
app.post('/api/ai/summarize', async (req, res) => {
  try {
    const { title, content, format = 'bullets', model } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is empty. Please add content before summarizing.' });
    }

    const ai = getAI();
    let formatInstruction = 'Provide a structured bullet-point summary highlighting the key points, core ideas, and conclusions.';
    if (format === 'executive') {
      formatInstruction = 'Provide a 2-paragraph executive brief summarizing the core thesis, background, and strategic takeaways.';
    } else if (format === 'tldr') {
      formatInstruction = 'Provide a 1-2 sentence high-impact TL;DR summarizing the single most important message.';
    } else if (format === 'action_items') {
      formatInstruction = 'Extract and list all actionable to-dos, decisions, and deadlines as a clean checklist (- [ ] Item).';
    }

    const prompt = `You are an expert summarizer in Notesitfy AI.
Analyze the following note:
Title: "${title || 'Untitled Note'}"

Note Content:
"""
${content}
"""

Task:
${formatInstruction}

Requirements:
- Output clean, readable Markdown without meta-commentary like "Here is your summary".
- Be precise, factual to the note, and well-organized.`;

    const response = await generateContentWithFallback(ai, {
      contents: prompt,
    }, model);

    const summary = response.text || 'Unable to generate summary.';
    res.json({ summary });
  } catch (error: any) {
    console.error('Error in /api/ai/summarize:', error);
    res.status(500).json({ error: error.message || 'Failed to generate summary' });
  }
});

// 3. Fix Grammar & Polish Tone
app.post('/api/ai/polish', async (req, res) => {
  try {
    const { title, content, tone = 'fix_grammar', model } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is empty.' });
    }

    const ai = getAI();
    let tonePrompt = 'Fix any spelling mistakes, punctuation errors, grammatical awkwardness, and stylistic inconsistencies.';
    if (tone === 'professional') {
      tonePrompt = 'Rewrite in a polished, professional, authoritative, and articulate business tone suitable for executive communications.';
    } else if (tone === 'casual') {
      tonePrompt = 'Rewrite in an engaging, approachable, natural, and conversational tone while maintaining clarity.';
    } else if (tone === 'concise') {
      tonePrompt = 'Make the writing as punchy, dense, and concise as possible. Cut fluff and redundant adjectives.';
    } else if (tone === 'academic') {
      tonePrompt = 'Enhance with rigorous vocabulary, structured reasoning, and scholarly precision.';
    }

    const prompt = `You are a writing assistant in Notesitfy AI.
Original Note Title: "${title || 'Untitled'}"

Original Content:
"""
${content}
"""

Instructions:
${tonePrompt}

Crucial Rules:
- Preserve markdown formatting (headings, lists, code blocks, bold, etc.) unless rephrasing requires restructuring.
- Return ONLY the improved revised text. Do NOT wrap it in conversational preamble ("Sure, here is your rewrite:").
- Provide pure markdown output.`;

    const response = await generateContentWithFallback(ai, {
      contents: prompt,
    }, model);

    const polished = response.text || content;
    res.json({ polished, tone });
  } catch (error: any) {
    console.error('Error in /api/ai/polish:', error);
    res.status(500).json({ error: error.message || 'Failed to polish content' });
  }
});

// 4. Expand / Brainstorm
app.post('/api/ai/expand', async (req, res) => {
  try {
    const { title, content, mode = 'next_steps', model } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is empty. Add initial ideas first.' });
    }

    const ai = getAI();
    let modeInstruction = 'Generate concrete, prioritized next steps and implementation recommendations based on this note.';
    if (mode === 'brainstorm') {
      modeInstruction = 'Brainstorm 5-7 creative, out-of-the-box ideas, angles, or unexplored opportunities expanding upon this note.';
    } else if (mode === 'continue') {
      modeInstruction = 'Continue writing the next logical paragraphs or sections in the same style, tone, and narrative thread.';
    } else if (mode === 'key_questions') {
      modeInstruction = 'Formulate 5 critical, probing questions that will challenge assumptions, uncover blind spots, and deepen this note.';
    }

    const prompt = `You are an ideation partner in Notesitfy AI.
Active Note Title: "${title || 'Untitled'}"

Active Note Content:
"""
${content}
"""

Task:
${modeInstruction}

Formatting Rules:
- Format response with clear Markdown headings (###) and bullet lists.
- Be actionable, insightful, and directly relevant.
- Do NOT include conversational pleasantries ("Here are some ideas:"). Output clean markdown.`;

    const response = await generateContentWithFallback(ai, {
      contents: prompt,
    }, model);

    const expansion = response.text || 'No suggestions generated.';
    res.json({ expansion });
  } catch (error: any) {
    console.error('Error in /api/ai/expand:', error);
    res.status(500).json({ error: error.message || 'Failed to brainstorm/expand' });
  }
});

// 5. Ask Gemini - Note Chat Assistant
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { messages, activeNote, model } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    const ai = getAI();

    let noteContext = 'No specific note is currently open.';
    if (activeNote) {
      noteContext = `Active Note Title: ${activeNote.title || 'Untitled'}
Category/Folder: ${activeNote.folder || 'General'}
Tags: ${Array.isArray(activeNote.tags) ? activeNote.tags.join(', ') : 'none'}
Content:
"""
${activeNote.content || '(empty note)'}
"""`;
    }

    const systemInstruction = `You are Notesitfy AI, an intelligent, empathetic, and exceptionally capable thinking partner embedded in a personal knowledge workspace.
You have immediate access to the user's active note:

---
${noteContext}
---

Your role:
- Answer questions directly about the active note or related general topics.
- Help critique, refine, elaborate, find missing logic, or create related artifacts (quizzes, emails, outlines, formulas).
- If the user asks general questions unrelated to the note, answer them accurately and clearly while remaining helpful.
- Keep responses readable, succinct, and beautifully formatted in markdown.`;

    // Map conversation history
    const contents: any[] = [];
    for (const msg of messages) {
      contents.push({
        role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    const response = await generateContentWithFallback(ai, {
      contents,
      config: {
        systemInstruction,
      },
    }, model);

    const reply = response.text || 'I could not generate a reply.';
    res.json({ reply });
  } catch (error: any) {
    console.error('Error in /api/ai/chat:', error);
    res.status(500).json({ error: error.message || 'Failed to process chat message' });
  }
});

// 6. Suggest Tags & Smart Metadata
app.post('/api/ai/suggest-tags', async (req, res) => {
  try {
    const { title, content, model } = req.body;
    if (!content && !title) {
      return res.status(400).json({ error: 'Content or title is required.' });
    }

    const ai = getAI();
    const prompt = `Analyze this note and suggest 3 to 5 relevant lowercase tags (e.g. "meeting", "roadmap", "architecture", "ideas", "personal", "finance", "research") and the single best folder category (e.g. "Work", "Personal", "Projects", "Ideas", "Archive").
Respond ONLY with a valid JSON object in this exact shape:
{
  "tags": ["tag1", "tag2", "tag3"],
  "folder": "FolderName"
}

Title: "${title || ''}"
Content:
"""
${content || ''}
"""`;

    const response = await generateContentWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    }, model);

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      folder: parsed.folder || 'General',
    });
  } catch (error: any) {
    console.error('Error in /api/ai/suggest-tags:', error);
    res.status(500).json({ error: error.message || 'Failed to suggest tags' });
  }
});

// Vite Middleware for development vs Static Server for production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Notesitfy AI] Server running at http://localhost:${PORT}`);
  });
}

startServer();