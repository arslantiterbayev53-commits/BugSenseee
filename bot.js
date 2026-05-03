// bot.js — Telegram bot handlers (Telegraf)

const { Telegraf } = require('telegraf');
const axios = require('axios');
const { askAI, analyzeImage } = require('./ai');
const { clearSession } = require('./session');
const { WELCOME_MESSAGE } = require('./prompts');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip Telegram HTML tags → plain text fallback.
 */
function stripHTML(text) {
  return text
    .replace(/<b>([\s\S]*?)<\/b>/g, '$1')
    .replace(/<i>([\s\S]*?)<\/i>/g, '$1')
    .replace(/<code>([\s\S]*?)<\/code>/g, '$1')
    .replace(/<pre>([\s\S]*?)<\/pre>/g, '$1')
    .replace(/<[^>]+>/g, '');
}

/**
 * Send one chunk — tries HTML first, falls back to plain text.
 */
async function sendChunk(ctx, text) {
  try {
    await ctx.replyWithHTML(text);
  } catch {
    try {
      await ctx.reply(stripHTML(text));
    } catch (e) {
      console.error('sendChunk failed:', e.message);
    }
  }
}

/**
 * Split long messages into ≤3800 char chunks and send each.
 */
async function sendLongMessage(ctx, text) {
  const MAX = 3800;
  if (text.length <= MAX) return sendChunk(ctx, text);

  const paragraphs = text.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length > MAX) {
      if (current) {
        await sendChunk(ctx, current);
        current = para;
      } else {
        // Single paragraph too long — split by lines
        for (const line of para.split('\n')) {
          const nextLine = current ? `${current}\n${line}` : line;
          if (nextLine.length > MAX) {
            if (current) await sendChunk(ctx, current);
            current = line;
          } else {
            current = nextLine;
          }
        }
      }
    } else {
      current = next;
    }
  }
  if (current) await sendChunk(ctx, current);
}

/**
 * Show ⏳ loader, run async fn(), delete loader, send reply.
 * Handles rate-limit and generic errors gracefully.
 */
async function sendWithLoading(ctx, fn) {
  const loader = await ctx.reply('⏳');
  try {
    const reply = await fn();
    await ctx.telegram.deleteMessage(ctx.chat.id, loader.message_id).catch(() => {});
    await sendLongMessage(ctx, reply);
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loader.message_id).catch(() => {});
    console.error('Handler error:', err.message);
    if (err.status === 429) {
      await ctx.reply('⏱️ Лимит запросов. Подожди пару минут и попробуй снова.');
    } else {
      await ctx.reply('⚠️ Произошла ошибка. Попробуй ещё раз.');
    }
  }
}

// ── Commands ───────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  try {
    await ctx.replyWithHTML(WELCOME_MESSAGE(ctx.from?.first_name));
  } catch {
    await ctx.reply('Привет! Я BugSense. Отправь код или вопрос!');
  }
});

bot.command('clear', async (ctx) => {
  clearSession(ctx.from.id);
  await ctx.reply('🗑️ История очищена!');
});

bot.command('help', async (ctx) => {
  try {
    await ctx.replyWithHTML(
      '<b>BugSense — Помощь</b>\n\n' +
      '/start — Приветствие\n' +
      '/clear — Очистить историю диалога\n' +
      '/help — Эта справка\n\n' +
      '<b>Как использовать:</b>\n' +
      '• Текст / вопрос → отвечаю\n' +
      '• Код → нахожу все баги\n' +
      '• Фото / скриншот → анализирую\n' +
      '• Файл с кодом → проверяю\n\n' +
      '<i>Отвечаю на твоём языке 🌍</i>'
    );
  } catch {
    await ctx.reply('Команды: /start /clear /help\nОтправь код, вопрос или фото!');
  }
});

// ── Message handlers ───────────────────────────────────────────────────────

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  await ctx.sendChatAction('typing');
  await sendWithLoading(ctx, () => askAI(userId, text));
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const caption = ctx.message.caption || '';
  await ctx.sendChatAction('typing');

  await sendWithLoading(ctx, async () => {
    // Pick highest-resolution photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await axios.get(link.href, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(res.data).toString('base64');
    return analyzeImage(userId, base64, 'image/jpeg', caption);
  });
});

bot.on('document', async (ctx) => {
  const userId = ctx.from.id;
  const doc = ctx.message.document;
  const caption = ctx.message.caption || 'Найди все баги и проблемы в этом файле.';

  if (doc.file_size > 2 * 1024 * 1024) {
    return ctx.reply('⚠️ Файл слишком большой. Максимум 2 MB.');
  }

  await ctx.sendChatAction('typing');
  await sendWithLoading(ctx, async () => {
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const res = await axios.get(link.href, { responseType: 'text' });
    const prompt = `${caption}\n\nФайл: <code>${doc.file_name}</code>\n<pre>${res.data}</pre>`;
    return askAI(userId, prompt);
  });
});

module.exports = bot;