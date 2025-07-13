const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// نقرأ التوكن من متغير البيئة لزيادة الأمان
const TOKEN = process.env.BOT_TOKEN || '7627854214:AAHx-_W9mjYniLOILUe0EwY3mNMlwSRnGJs';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vxskgruvkdppbrjrjzib.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4c2tncnV2a2RwcGJyanJqemliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5Njc4ODUsImV4cCI6MjA2NzU0Mzg4NX0.3MIlGwTuu32TOND5pN6HhwMDUiiIh70hp-G28d-u9a0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {}; // لحفظ حالة المستخدم بين الرسائل
let BOT_USERNAME = process.env.BOT_USERNAME;

// إذا لم يتم توفير اسم المستخدم نحاول الحصول عليه تلقائياً من تليجرام
if (!BOT_USERNAME) {
  bot.getMe().then(me => {
    BOT_USERNAME = me.username;
  });
}

async function addTask(task) {
  const { data, error } = await supabase
    .from('tasks')
    .insert(task)
    .select('*')
    .single();
  if (error) {
    console.error('❌ خطأ في إضافة المهمة:', error);
    return null;
  }
  return data;
}

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `أهلاً ${msg.from.first_name} 🌟\nاستخدم /add لإضافة مهمة جديدة خطوة بخطوة ✍️`);
});

// /add (يبدأ محادثة تفاعلية)
bot.onText(/\/add/, (msg) => {
  const userid = msg.from.id;
  if (msg.chat.type === 'private') {
    userStates[userid] = { step: 'title', data: {} };
    return bot.sendMessage(userid, '📌 ما هو عنوان المهمة؟');
  }
  userStates[userid] = { step: 'title', data: {}, groupId: msg.chat.id };
  bot.sendMessage(userid, '📌 ما هو عنوان المهمة؟');
  bot.sendMessage(msg.chat.id, `🔔 سيتم متابعة إضافة المهمة في الخاص مع @${msg.from.username || msg.from.first_name}.`);
});

// الردود التفاعلية حسب الخطوة
bot.on('message', async (msg) => {
  const userid = msg.from.id;

  // إذا تمت مناداة البوت في مجموعة نبدأ المحادثة في الخاص
  if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && BOT_USERNAME) {
    if (msg.text && msg.text.includes(`@${BOT_USERNAME}`)) {
      userStates[userid] = { step: 'title', data: {}, groupId: msg.chat.id };
      bot.sendMessage(userid, '📌 ما هو عنوان المهمة؟');
      bot.sendMessage(msg.chat.id, `🔔 سيتم متابعة إضافة المهمة في الخاص مع @${msg.from.username || msg.from.first_name}.`);
      return;
    }
    return;
  }

  if (msg.chat.type !== 'private') return;

  const state = userStates[userid];

  // تجاهل أوامر أخرى
  if (!state || msg.text.startsWith('/')) return;

  switch (state.step) {
    case 'title':
      state.data.title = msg.text;
      state.step = 'description';
      bot.sendMessage(userid, '📝 أضف وصف للمهمة (أو اكتب - إذا لا يوجد):');
      break;

    case 'description':
      state.data.description = msg.text === '-' ? '' : msg.text;
      state.step = 'priority';
      bot.sendMessage(userid, '❗ اختر أولوية المهمة:', {
        reply_markup: {
          keyboard: [['🔥 عالي'], ['📋 متوسط'], ['🧊 منخفض']],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      break;

    case 'priority':
      if (!['🔥 عالي', '📋 متوسط', '🧊 منخفض'].includes(msg.text)) {
        return bot.sendMessage(userid, '🚫 الرجاء اختيار أولوية من الخيارات.');
      }
      state.data.priority = msg.text.includes('عالي') ? 'عالي' : msg.text.includes('منخفض') ? 'منخفض' : 'متوسط';
      state.step = 'status';
      bot.sendMessage(userid, '📊 اختر حالة المهمة:', {
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
        return bot.sendMessage(userid, '❌ يرجى اختيار حالة من القائمة.');
      }

      // حفظ المهمة
      const newTask = {
        title: state.data.title,
        description: state.data.description,
        priority: state.data.priority,
        status: selected,
        completed: selected === 'مكتمل',
        createdat: new Date().toISOString(),
        completedat: selected === 'مكتمل' ? new Date().toISOString() : null,
        userid: msg.from.id,
        username: msg.from.username || msg.from.first_name,
        tags: []
      };
      await addTask(newTask);
      bot.sendMessage(userid, `✅ تمت إضافة المهمة:\n• ${newTask.title}\n📊 ${newTask.status} | ❗ ${newTask.priority}`, {
        reply_markup: { remove_keyboard: true }
      });

      if (state.groupId) {
        bot.sendMessage(state.groupId, `✅ تمت إضافة مهمة جديدة بواسطة @${msg.from.username || msg.from.first_name}.`);
      }

      delete userStates[userid]; // ننهي المحادثة
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

