const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');

// نقرأ التوكن من متغير البيئة لزيادة الأمان
const TOKEN = process.env.BOT_TOKEN || '7627854214:AAHx-_W9mjYniLOILUe0EwY3mNMlwSRnGJs';
const TASKS_FILE = path.join(__dirname, 'tasks.json');

const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {}; // لحفظ حالة المستخدم بين الرسائل
let BOT_USERNAME = process.env.BOT_USERNAME;

// إذا لم يتم توفير اسم المستخدم نحاول الحصول عليه تلقائياً من تليجرام
if (!BOT_USERNAME) {
  bot.getMe().then(me => {
    BOT_USERNAME = me.username;
  });
}

async function loadTasks() {
  try {
    const data = await fs.readFile(TASKS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { tasks: [], counter: 1, lastUpdated: new Date().toISOString() };
  }
}

async function saveTasks(data) {
  await fs.writeFile(TASKS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `أهلاً ${msg.from.first_name} 🌟\nاستخدم /add لإضافة مهمة جديدة خطوة بخطوة ✍️`);
});

// /add (يبدأ محادثة تفاعلية)
bot.onText(/\/add/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { step: 'title', data: {} };
  bot.sendMessage(chatId, '📌 ما هو عنوان المهمة؟');
});

// الردود التفاعلية حسب الخطوة
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // إذا أُشير إلى البوت داخل مجموعة نرد برسالة بسيطة
  if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && BOT_USERNAME) {
    if (msg.text && msg.text.includes(`@${BOT_USERNAME}`)) {
      return bot.sendMessage(chatId, 'أنا هنا! ماذا تريد؟');
    }
  }

  const state = userStates[chatId];

  // تجاهل أوامر أخرى
  if (!state || msg.text.startsWith('/')) return;

  switch (state.step) {
    case 'title':
      state.data.title = msg.text;
      state.step = 'description';
      bot.sendMessage(chatId, '📝 أضف وصف للمهمة (أو اكتب - إذا لا يوجد):');
      break;

    case 'description':
      state.data.description = msg.text === '-' ? '' : msg.text;
      state.step = 'priority';
      bot.sendMessage(chatId, '❗ اختر أولوية المهمة:', {
        reply_markup: {
          keyboard: [['🔥 عالي'], ['📋 متوسط'], ['🧊 منخفض']],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      break;

    case 'priority':
      if (!['🔥 عالي', '📋 متوسط', '🧊 منخفض'].includes(msg.text)) {
        return bot.sendMessage(chatId, '🚫 الرجاء اختيار أولوية من الخيارات.');
      }
      state.data.priority = msg.text.includes('عالي') ? 'عالي' : msg.text.includes('منخفض') ? 'منخفض' : 'متوسط';
      state.step = 'status';
      bot.sendMessage(chatId, '📊 اختر حالة المهمة:', {
        reply_markup: {
          keyboard: [['🟠 جديد'], ['🟡 قيد الإنجاز'], ['✅ مكتمل']],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      break;

    case 'status':
      const statusOptions = {
        '🟠 جديد': 'جديد',
        '🟡 قيد الإنجاز': 'قيد الإنجاز',
        '✅ مكتمل': 'مكتمل'
      };

      const selected = statusOptions[msg.text];
      if (!selected) {
        return bot.sendMessage(chatId, '❌ يرجى اختيار حالة من القائمة.');
      }

      // حفظ المهمة
      const data = await loadTasks();
      const newTask = {
        id: data.counter++,
        title: state.data.title,
        description: state.data.description,
        priority: state.data.priority,
        status: selected,
        completed: selected === 'مكتمل',
        createdAt: new Date().toISOString(),
        completedAt: selected === 'مكتمل' ? new Date().toISOString() : undefined,
        archived: false,
        archivedAt: null,
        userId: msg.from.id,
        username: msg.from.username || msg.from.first_name,
        tags: []
      };

      data.tasks.push(newTask);
      data.lastUpdated = new Date().toISOString();
      await saveTasks(data);

      bot.sendMessage(chatId, `✅ تمت إضافة المهمة:\n• ${newTask.title}\n📊 ${newTask.status} | ❗ ${newTask.priority}`, {
        reply_markup: { remove_keyboard: true }
      });

      delete userStates[chatId]; // ننهي المحادثة
      break;
  }
});

const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// مجرد اختبار حتى Railway يعرف التطبيق شغّال
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

