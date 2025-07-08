
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vxskgruvkdppbrjrjzib.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4c2tncnV2a2RwcGJyanJqemliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5Njc4ODUsImV4cCI6MjA2NzU0Mzg4NX0.3MIlGwTuu32TOND5pN6HhwMDUiiIh70hp-G28d-u9a0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const AUTO_ARCHIVE_HOURS = 24; // المدة قبل الأرشفة التلقائية
const CHECK_INTERVAL = 60 * 60 * 1000; // ساعة للتحقق الدوري

// نقرأ التوكن من متغير البيئة لزيادة الأمان
const TOKEN = process.env.BOT_TOKEN || '7627854214:AAHx-_W9mjYniLOILUe0EwY3mNMlwSRnGJs';
const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {}; // لحفظ حالة المستخدم بين الرسائل
let BOT_USERNAME = process.env.BOT_USERNAME;

// الحصول على اسم المستخدم تلقائياً إن لم يتم تحديده
if (!BOT_USERNAME) {
    bot.getMe().then(me => {
        BOT_USERNAME = me.username;
    });
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 🔁 تحميل المهام من قاعدة البيانات
async function loadTasks() {
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('id', { ascending: true });
    if (error) {
        console.error('❌ خطأ في قراءة المهام:', error);
        return { tasks: [], counter: 1, lastUpdated: null, lastFinished: null };
    }
    let lastUpdated = null;
    let lastFinished = null;
    data.forEach(t => {
        const updated = t.updatedat || t.createdat;
        if (!lastUpdated || new Date(updated) > new Date(lastUpdated)) {
            lastUpdated = updated;
        }
        if (t.archivedat && (!lastFinished || new Date(t.archivedat) > new Date(lastFinished))) {
            lastFinished = t.archivedat;
        }
    });
    return { tasks: data, counter: data.length + 1, lastUpdated, lastFinished };
}

// 💾 إضافة مهمة جديدة
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

// تحديث مهمة عند الإكمال
async function markComplete(id) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('tasks')
        .update({ completed: true, status: 'مكتمل', completedat: now, updatedat: now })
        .eq('id', id)
        .select('*');
    if (error || !data.length) return null;
    return data[0];
}

// حذف مهمة
async function removeTask(id) {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    return !error;
}

// ⏹️ أرشفة جميع المهام الحالية
async function finishDay() {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('tasks')
        .update({ archived: true, archivedat: now, updatedat: now })
        .eq('archived', false);
    if (error) console.error('❌ خطأ في إنهاء اليوم:', error);
}

// ✅ نقطة اختبار
app.get('/', (req, res) => {
    res.send('Telegram bot is running...');
});

// ✅ عرض كل المهام
app.get('/tasks.json', async (req, res) => {
    const admin = req.query.admin;
    const data = await loadTasks();
    const tasks = admin ? data.tasks.filter(t => t.adminusername === admin) : data.tasks;
    res.json({ ...data, tasks });
});

// ✅ إكمال مهمة
app.post('/complete', async (req, res) => {
    const { id } = req.body;
    const task = await markComplete(id);
    if (task) {
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: '❌ المهمة غير موجودة' });
    }
});

// ✅ حذف مهمة
app.post('/delete', async (req, res) => {
    const { id } = req.body;
    const success = await removeTask(id);
    if (success) {
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

  // إذا تمت مناداة البوت داخل مجموعة نبدأ المحادثة في الخاص
  if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && BOT_USERNAME) {
    if (msg.text && msg.text.includes(`@${BOT_USERNAME}`)) {
      userStates[userid] = { step: 'title', data: {}, groupId: msg.chat.id };
      bot.sendMessage(userid, '📌 ما هو عنوان المهمة؟');
      bot.sendMessage(msg.chat.id, `🔔 سيتم متابعة إضافة المهمة في الخاص مع @${msg.from.username || msg.from.first_name}.`);
      return;
    }
    return; // تجاهل باقي رسائل المجموعات
  }

  // نتعامل فقط مع الرسائل الخاصة هنا
  if (msg.chat.type !== 'private') return;

  const state = userStates[userid];
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

      state.data.status = selected;
      state.step = 'admin';
      bot.sendMessage(userid, 'لمن موجهة هذه المهمة ؟ (يجب كتب رمز الشخص الموجهة له المهمة)');
      break;

    case 'admin':
      state.data.adminusername = msg.text.replace('@', '').trim();

      const newTask = {
        title: state.data.title,
        description: state.data.description,
        priority: state.data.priority,
        status: state.data.status,
        completed: state.data.status === 'مكتمل',
        createdat: new Date().toISOString(),
        completedat: state.data.status === 'مكتمل' ? new Date().toISOString() : null,
        archived: false,
        archivedat: null,
        userid: msg.from.id,
        username: msg.from.username || msg.from.first_name,
        adminusername: state.data.adminusername,
        tags: []
      };
      await addTask(newTask);
      bot.sendMessage(userid, `✅ تمت إضافة المهمة:\n• ${newTask.title}\n📊 ${newTask.status} | ❗ ${newTask.priority}`, {
        reply_markup: { remove_keyboard: true }
      });

      if (state.groupId) {
        bot.sendMessage(state.groupId, `✅ تمت إضافة مهمة جديدة بواسطة @${msg.from.username || msg.from.first_name}.`);
      }

      delete userStates[userid];
      break;
  }
});
