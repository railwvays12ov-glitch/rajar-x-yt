/**
 * WhatsApp MD transport using Baileys (@whiskeysockets/baileys v6).
 * Run: cp .env.example .env && node --env-file=.env baileys.mjs
 * Scan the QR code with the WhatsApp account that will act as the bot.
 * Baileys' API changes between releases — check its docs if an import moved.
 */
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import { createBot } from './bot-core.mjs';
import { RajarClient } from './rajarClient.mjs';

const list = (v) =>
  new Set(
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const onMessage = createBot({
  client: new RajarClient({ baseUrl: process.env.RAJAR_X_BASE_URL, apiKey: process.env.RAJAR_X_API_KEY }),
  allowedUsers: list(process.env.BOT_ALLOWED_USERS),
  allowedGroups: list(process.env.BOT_ALLOWED_GROUPS),
  maxFileBytes: Number(process.env.BOT_MAX_FILE_BYTES ?? 64 * 1024 * 1024),
  cooldownSeconds: Number(process.env.BOT_COOLDOWN_SECONDS ?? 60),
});

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'warn' }) });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log('Scan this QR in WhatsApp → Linked devices:\n', qr);
    if (connection === 'close') {
      const loggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      if (!loggedOut) setTimeout(start, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (m.key.fromMe || !m.message) continue;
      const chat = m.key.remoteJid;
      const isGroup = chat?.endsWith('@g.us');
      const text = m.message.conversation ?? m.message.extendedTextMessage?.text ?? '';
      await onMessage({
        sender: isGroup ? m.key.participant : chat,
        group: isGroup ? chat : null,
        text,
        reply: (t) => sock.sendMessage(chat, { text: t }, { quoted: m }),
        sendFile: (buffer, fileName, mimetype, caption) =>
          sock.sendMessage(chat, { document: buffer, fileName, mimetype, caption }, { quoted: m }),
      }).catch((err) => console.error('[rajar-bot] handler error', err.code ?? err.message));
    }
  });
}

start();
