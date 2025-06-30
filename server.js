const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TASKS_FILE = path.join(__dirname, 'tasks.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// تحميل المهام من الملف
async function loadTasks() {
    try {
        const data = await fs.readFile(TASKS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log('⚠️ لا يوجد ملف مهام، يتم إنشاء ملف جديد...');
        return { tasks: [], counter: 1, lastUpdated: new Date().toISOString() };
    }
}

// حفظ المهام إلى الملف
async function saveTasks(data) {
    try {
        await fs.writeFile(TASKS_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('❌ خطأ في حفظ المهام:', error);
        return false;
    }
}

// ✅ عرض كل المهام
app.get('/tasks.json', async (req, res) => {
    const data = await loadTasks();
    res.json(data);
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

// ✅ تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
});
