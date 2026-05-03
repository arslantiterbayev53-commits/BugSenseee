const Groq = require('groq-sdk');
const { SYSTEM_PROMPT } = require('./prompts');
const { getHistory, addMessage } = require('./session');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELS = ['llama-3.3-70b-versatile', 'gemma2-9b-it'];
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

function fixMarkdown(text) {
  return text
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
}

async function callGroq(messages, modelIndex = 0) {
  if (modelIndex >= MODELS.length) throw new Error('All models unavailable.');
  try {
    const res = await groq.chat.completions.create({
      model: MODELS[modelIndex],
      messages,
      max_tokens: 2048,
      temperature: 0.4,
    });
    return res.choices[0]?.message?.content || '⚠️ No response.';
  } catch (err) {
    if (err.status === 429 || err.status === 413 || err.status === 503) {
      console.log(`${MODELS[modelIndex]} limit, switching...`);
      return callGroq(messages, modelIndex + 1);
    }
    throw err;
  }
}

async function askAI(userId, userMessage) {
  addMessage(userId, 'user', userMessage);
  const raw = await callGroq([
    { role: 'system', content: SYSTEM_PROMPT },
    ...getHistory(userId),
  ]);
  const reply = fixMarkdown(raw);
  addMessage(userId, 'assistant', reply);
  return reply;
}

async function analyzeImage(userId, base64Image, mimeType, caption) {
  const prompt = caption || 'Analyze this image. If code: find all bugs, give complete fixed code. If error: explain and fix. Reply in same language as image text.';
  addMessage(userId, 'user', `[Image] ${caption || 'analyze'}`);
  try {
    const res = await groq.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0.4,
    });
    const raw = res.choices[0]?.message?.content || '⚠️ Could not analyze.';
    const reply = fixMarkdown(raw);
    addMessage(userId, 'assistant', reply);
    return reply;
  } catch (err) {
    if (err.status === 429 || err.status === 413) return '⚠️ Limit. Try again in a minute.';
    throw err;
  }
}

module.exports = { askAI, analyzeImage };