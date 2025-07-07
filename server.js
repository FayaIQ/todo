
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const AUTO_ARCHIVE_HOURS = 12; // المدة قبل الأرشفة التلقائية
const CHECK_INTERVAL = 60 * 60 * 1000; // ساعة للتحقق الدوري

const TOKEN = '7627854214:AAHx-_W9mjYniLOILUe0EwY3mNMlwSRnGJs'; // ← غيّره بالتوكن الحقيقي
const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {}; // لحفظ حالة المستخدم بين الرسائل

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 🔁 تحميل المهام من الملف
async function loadTasks() {
    try {
        const data = await fs.readFile(TASKS_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        console.log('⚠️ لا يوجد ملف مهام، يتم إنشاء ملف جديد...');
        return {
            tasks: [],
            counter: 1,
            lastUpdated: new Date().toISOString(),
            lastFinished: new Date().toISOString()
        };
    }
}

// 💾 حفظ المهام إلى الملف
async function saveTasks(data) {
    try {
        await fs.writeFile(TASKS_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('❌ خطأ في حفظ المهام:', error);
        return false;
    }
}

// ⏹️ أرشفة جميع المهام الحالية
async function finishDay() {
    const data = await loadTasks();
    const now = new Date().toISOString();
    data.tasks.forEach(task => {
        if (!task.archived) {
            task.archived = true;
            task.archivedAt = now;
        }
    });
    data.lastFinished = now;
    await saveTasks(data);
}

// ✅ نقطة اختبار
app.get('/', (req, res) => {
    res.send('Telegram bot is running...');
});

// ✅ عرض كل المهام
app.get('/tasks.json', async (req, res) => {
    const admin = req.query.admin;
    const data = await loadTasks();
    if (admin) {
        res.json({
            ...data,
            tasks: data.tasks.filter(t => t.adminUsername === admin)
        });
    } else {
        res.json(data);
    }
});

// ✅ إكمال مهمة
app.post('/complete', async (req, res) => {
    const { id } = req.body;
    const data = await loadTasks();
    const task = data.tasks.find(t => t.id === id);
    if (task) {
        task.completed = true;
        task.status = 'مكتمل';
        task.completedAt = new Date().toISOString();
        data.lastUpdated = new Date().toISOString();
        await saveTasks(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: '❌ المهمة غير موجودة' });
    }
});

// ✅ حذف مهمة
app.post('/delete', async (req, res) => {
    const { id } = req.body;
    const data = await loadTasks();
    const index = data.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
        data.tasks.splice(index, 1);
        data.lastUpdated = new Date().toISOString();
        await saveTasks(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: '❌ المهمة غير موجودة' });
    }
});

// ✅ إنهاء اليوم (أرشفة جميع المهام)
app.post('/finish_day', async (req, res) => {
    await finishDay();
    res.json({ success: true });
});

// فحص أولي عند التشغيل
(async () => {
    const data = await loadTasks();
    const last = new Date(data.lastFinished || data.lastUpdated);
    if (Date.now() - last.getTime() > AUTO_ARCHIVE_HOURS * 60 * 60 * 1000) {
        await finishDay();
    }
})();

setInterval(async () => {
    const data = await loadTasks();
    const last = new Date(data.lastFinished || data.lastUpdated);
    if (Date.now() - last.getTime() > AUTO_ARCHIVE_HOURS * 60 * 60 * 1000) {
        await finishDay();
        console.log('✅ تم إنهاء اليوم تلقائياً');
    }
}, CHECK_INTERVAL);

// ✅ تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
});

// ====== Telegram Bot Logic ======

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
  const state = userStates[chatId];
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

      state.data.status = selected;
      state.step = 'admin';
      bot.sendMessage(chatId, '👮‍♂️ اكتب يوزر الأدمن المسؤول (بدون @):');
      break;

    case 'admin':
      state.data.adminUsername = msg.text.replace('@', '').trim();

      const data = await loadTasks();
      const newTask = {
        id: data.counter++,
        title: state.data.title,
        description: state.data.description,
        priority: state.data.priority,
        status: state.data.status,
        completed: state.data.status === 'مكتمل',
        createdAt: new Date().toISOString(),
        completedAt: state.data.status === 'مكتمل' ? new Date().toISOString() : undefined,
        archived: false,
        archivedAt: null,
        userId: msg.from.id,
        username: msg.from.username || msg.from.first_name,
        adminUsername: state.data.adminUsername,
        tags: []
      };

      data.tasks.push(newTask);
      data.lastUpdated = new Date().toISOString();
      await saveTasks(data);

      bot.sendMessage(chatId, `✅ تمت إضافة المهمة:\n• ${newTask.title}\n📊 ${newTask.status} | ❗ ${newTask.priority}`, {
        reply_markup: { remove_keyboard: true }
      });

      delete userStates[chatId];
      break;
  }
});
