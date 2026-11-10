import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3000;
const SHARED_CONFIG_PATH = path.resolve(process.cwd(), 'shared-spreadsheet.json');

app.use(express.json());

// API đọc thông tin bảng tính dùng chung
app.get('/api/shared-sheet', (_req, res) => {
  try {
    if (fs.existsSync(SHARED_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(SHARED_CONFIG_PATH, 'utf-8'));
      return res.json(data);
    }
    return res.json({ spreadsheetId: null, spreadsheetName: null, ownerEmail: null });
  } catch (error) {
    console.error('Lỗi đọc shared-spreadsheet.json:', error);
    return res.status(500).json({ error: 'Không thể đọc cấu hình bảng tính dùng chung' });
  }
});

// API lưu / đồng bộ thông tin bảng tính dùng chung giữa các giảng viên
app.post('/api/shared-sheet', (req, res) => {
  try {
    const { spreadsheetId, spreadsheetName, ownerEmail, webViewLink } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Thiếu spreadsheetId' });
    }
    const data = {
      spreadsheetId,
      spreadsheetName: spreadsheetName || 'Sổ điểm danh',
      ownerEmail: ownerEmail || null,
      webViewLink: webViewLink || null,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SHARED_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Lỗi lưu shared-spreadsheet.json:', error);
    return res.status(500).json({ error: 'Không thể lưu cấu hình bảng tính dùng chung' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server chạy tại cổng ${PORT}`);
  });
}

startServer();
