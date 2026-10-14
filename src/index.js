require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());

const VK_ACCESS_TOKEN = process.env.VK_ACCESS_TOKEN;
const PROXYAPI_BASE_URL = process.env.PROXYAPI_BASE_URL || 'https://api.proxyapi.ru';
const PROXYAPI_API_KEY = process.env.PROXYAPI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'openai/gpt-4.1-mini';
const SYSTEM_PROMPT_PATH = process.env.SYSTEM_PROMPT_PATH || './prompts/alina_system_prompt.md';
const KNOWLEDGE_BASE_PATH = process.env.KNOWLEDGE_BASE_PATH || './data/knowledge.json';

let systemPrompt = '';
let knowledgeBase = {};

function loadSystemPrompt() {
  try {
    const promptPath = path.resolve(__dirname, '..', SYSTEM_PROMPT_PATH);
    systemPrompt = fs.readFileSync(promptPath, 'utf8');
    console.log('Системный промпт загружен');
  } catch (error) {
    console.error('Ошибка загрузки системного промпта:', error.message);
    systemPrompt = 'Ты - бот Алина от университета Zerocoder. Отвечай только по темам Zerocoder.';
  }
}

function loadKnowledgeBase() {
  try {
    const kbPath = path.resolve(__dirname, '..', KNOWLEDGE_BASE_PATH);
    const kbData = fs.readFileSync(kbPath, 'utf8');
    knowledgeBase = JSON.parse(kbData);
    console.log('База знаний загружена');
  } catch (error) {
    console.error('Ошибка загрузки базы знаний:', error.message);
    knowledgeBase = {};
  }
}

loadSystemPrompt();
loadKnowledgeBase();

function buildContext() {
  let contextText = systemPrompt;
  contextText += '\n\n## Дополнительный контекст о Zerocoder (из базы знаний):\n';
  try {
    contextText += JSON.stringify(knowledgeBase, null, 2);
  } catch (e) {
    contextText += 'База знаний недоступна';
  }
  return contextText;
}

async function callProxyAPI(userMessage, chatHistory = []) {
  if (!PROXYAPI_API_KEY) {
    console.error('PROXYAPI_API_KEY не настроен');
    return 'Извините, бот не настроен для работы с ИИ. Обратитесь к администратору.';
  }

  const messages = [
    { role: 'system', content: buildContext() },
    ...chatHistory,
    { role: 'user', content: userMessage }
  ];

  try {
    const response = await axios.post(
      PROXYAPI_BASE_URL + '/v1/chat/completions',
      {
        model: AI_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': 'Bearer ' + PROXYAPI_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const choice = response.data && response.data.choices && response.data.choices[0];
    const answer = choice && choice.message && choice.message.content;
    if (answer) {
      return answer;
    }
    console.error('Пустой ответ от proxyapi.ru:', response.data);
    return 'Извините, не могу сформировать ответ';
  } catch (error) {
    const errData = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    console.error('Ошибка при обращении к proxyapi.ru:', errData);
    return 'Произошла техническая ошибка при генерации ответа. Пожалуйста, попробуйте позже или свяжитесь с менеджером.';
  }
}

async function sendVKMessage(userId, message) {
  if (!VK_ACCESS_TOKEN) {
    console.error('VK_ACCESS_TOKEN не настроен');
    return;
  }

  try {
    const params = {
      user_id: userId,
      message: message,
      random_id: Math.floor(Math.random() * 1000000000),
      access_token: VK_ACCESS_TOKEN,
      v: '5.131'
    };
    await axios.post('https://api.vk.com/method/messages.send', params);
  } catch (error) {
    const errData = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    console.error('Ошибка отправки сообщения ВК:', errData);
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'OK', bot: 'Алина (Zerocoder)' });
});

app.post('/vk/callback', async (req, res) => {
  const body = req.body || {};
  const type = body.type;
  const object = body.object;

  if (type === 'confirmation') {
    return res.send(process.env.VK_CONFIRMATION_CODE || 'confirmation');
  }

  if (type === 'message_new' && object && object.message) {
    const message = object.message;
    const userId = message.from_id;
    const text = message.text || '';
    if (text.trim()) {
      try {
        const response = await callProxyAPI(text);
        await sendVKMessage(userId, response);
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
        await sendVKMessage(userId, 'Извините, возникла ошибка. Попробуйте повторить вопрос позже.');
      }
    }
  }

  res.send('ok');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Бот Алины запущен на порту ' + PORT);
});