
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vxskgruvkdppbrjrjzib.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4c2tncnV2a2RwcGJyanJqemliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5Njc4ODUsImV4cCI6MjA2NzU0Mzg4NX0.3MIlGwTuu32TOND5pN6HhwMDUiiIh70hp-G28d-u9a0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// نقرأ التوكن من متغير البيئة لزيادة الأمان
const TOKEN = process.env.BOT_TOKEN || '7627854214:AAHx-_W9mjYniLOILUe0EwY3mNMlwSRnGJs';
const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {}; // لحفظ حالة المستخدم بين الرسائل
let BOT_USERNAME = process.env.BOT_USERNAME;

const ADMIN_HASH = process.env.ADMIN_CODE_HASH || '1ffe1c525e5a599d8bf42285c492ca90bb2d83e13ab3bf42fe36387edf091f96';
const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:3000';

function verifyAdmin(code) {
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    return hash === ADMIN_HASH;
}
async function refreshUsers() {
    const { data, error } = await supabase
        .from('allowed_users')
        .select('username, telegram_id');
    if (error) {
        console.error('خطأ في تحميل المستخدمين:', error);
        return [];
    }
    userRecords = data || [];
    return userRecords.map(u => u.username);
}

async function addUser(username) {
    const { error } = await supabase
        .from('allowed_users')
        .insert({ username })
        .select();
    if (error && !error.message.includes('duplicate')) {
        console.error('خطأ في إضافة المستخدم:', error);
    }
    return refreshUsers();
}

async function upsertUser(username, telegramId) {
    const { error } = await supabase
        .from('allowed_users')
        .upsert({ username, telegram_id: telegramId }, { onConflict: 'username' });
    if (error) console.error('خطأ في تحديث المستخدم:', error);
    return refreshUsers();
}

let userRecords = [];
let users = loadUsers();
refreshUsers().then(u => { users = u; });
function loadUsers() {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8'));
        return data.users || [];
    } catch (e) {
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(path.join(__dirname, 'users.json'), JSON.stringify({ users }, null, 2));
}

function loadPending() {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'pending.json'), 'utf8'));
        return data.pending || {};
    } catch (e) {
        return {};
    }
}

function savePending(pending) {
    fs.writeFileSync(path.join(__dirname, 'pending.json'), JSON.stringify({ pending }, null, 2));
}

function queueNotification(username, text) {
    if (!username) return;
    if (!pendingNotifications[username]) pendingNotifications[username] = [];
    pendingNotifications[username].push(text);
    savePending(pendingNotifications);
}

let pendingNotifications = loadPending();

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
        t.deleted = t.deleted || false;
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
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('tasks')
        .update({ deleted: true, deletedat: now, updatedat: now })
        .eq('id', id)
        .select('*');
    if (error || !data.length) return null;
    return data[0];
}

// ⏹️ تم تعطيل الأرشفة
async function finishDay() {
    // الأرشفة معطلة حالياً
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
    const task = await removeTask(id);
    if (task) {
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: '❌ المهمة غير موجودة' });
    }
});

// ✅ إنهاء اليوم - الأرشفة معطلة حالياً
app.post('/finish_day', (req, res) => {
    res.json({ success: true, message: 'archiving disabled' });
});

// فحص أولي عند التشغيل
// تم تعطيل الأرشفة التلقائية

// ✅ تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
});

// ====== Telegram Bot Logic ======

// /start
bot.onText(/\/start/, async (msg) => {
  const username = msg.from.username || msg.from.first_name;
  await upsertUser(username, msg.from.id);
  bot.sendMessage(msg.chat.id, `أهلاً ${msg.from.first_name} 🌟\nاستخدم /add لإضافة مهمة جديدة خطوة بخطوة ✍️`).then(() => {
    return bot.sendMessage(msg.chat.id, `رابط منصة المهام: ${PLATFORM_URL}`);
  }).then(res => {
    bot.pinChatMessage(msg.chat.id, res.message_id).catch(() => {});
  });

  if (pendingNotifications[username] && pendingNotifications[username].length) {
    for (const text of pendingNotifications[username]) {
      await bot.sendMessage(msg.chat.id, text).catch(() => {});
    }
    delete pendingNotifications[username];
    savePending(pendingNotifications);
  }
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
      const options = users.map(u => [u]);
      options.push(['➕ اضف شخص']);
      bot.sendMessage(userid, 'لمن موجهة هذه المهمة؟ اختر من القائمة:', {
        reply_markup: {
          keyboard: options,
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      break;

    case 'admin':
      if (msg.text === '➕ اضف شخص') {
        state.step = 'verifyAdmin';
        bot.sendMessage(userid, '🔑 أدخل رمز الأدمن لإضافة موظف جديد:');
        break;
      }

      if (!users.includes(msg.text)) {
        bot.sendMessage(userid, '❌ الرجاء اختيار رمز من القائمة.');
        break;
      }

      state.data.adminusername = msg.text.replace('@', '').trim();

      const newTask = {
        title: state.data.title,
        description: state.data.description,
        priority: state.data.priority,
        status: state.data.status,
        completed: state.data.status === 'مكتمل',
        deleted: false,
        deletedat: null,
        createdat: new Date().toISOString(),
        completedat: state.data.status === 'مكتمل' ? new Date().toISOString() : null,
        userid: msg.from.id,
        username: msg.from.username || msg.from.first_name,
        adminusername: state.data.adminusername,
        tags: []
      };
      await addTask(newTask);
      const assigned = userRecords.find(u => u.username === state.data.adminusername);
      let notifyText = `📋 تم إضافة لك مهمة بواسطة @${msg.from.username || msg.from.first_name}`;
      notifyText += `\nالمهمة هي: ${newTask.title}`;
      if (newTask.description) {
        notifyText += `\n📝 ${newTask.description}`;
      }
      if (assigned && assigned.telegram_id) {
        try {
          await bot.sendMessage(assigned.telegram_id, notifyText);
        } catch (e) {
          queueNotification(state.data.adminusername, notifyText);
          bot.sendMessage(userid, '⚠️ تعذر إرسال المهمة للمستخدم. سيتم إعلامه عند تشغيله للبوت.');
        }
      } else {
        queueNotification(state.data.adminusername, notifyText);
        bot.sendMessage(userid, '⚠️ المستخدم لم يفتح البوت بعد. سيتم إعلامه عند تشغيله للبوت.');
      }
      bot.sendMessage(userid, `✅ تمت إضافة المهمة:\n• ${newTask.title}\n📊 ${newTask.status} | ❗ ${newTask.priority}`, {
        reply_markup: { remove_keyboard: true }
      });

      if (state.groupId) {
        bot.sendMessage(state.groupId, `✅ تمت إضافة مهمة جديدة بواسطة @${msg.from.username || msg.from.first_name}.`);
      }

      delete userStates[userid];
      break;

    case 'verifyAdmin':
      if (!verifyAdmin(msg.text)) {
        bot.sendMessage(userid, '❌ رمز الأدمن غير صحيح.');
        break;
      }
      state.step = 'addPerson';
      bot.sendMessage(userid, '👤 أدخل يوزر الشخص الجديد:');
      break;

    case 'addPerson':
      const newUser = msg.text.replace('@', '').trim();
      if (!newUser) {
        bot.sendMessage(userid, '❌ يوزر غير صالح.');
        break;
      }
      if (!users.includes(newUser)) {
        users = await addUser(newUser);
        users.push(newUser);
        saveUsers(users);
      }
      state.step = 'admin';
      const opts = users.map(u => [u]);
      opts.push(['➕ اضف شخص']);
      bot.sendMessage(userid, `✅ تم إضافة ${newUser}. اختر من القائمة:`, {
        reply_markup: {
          keyboard: opts,
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      break;
  }
});
