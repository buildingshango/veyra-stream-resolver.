import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

const getQueryValue = (value: unknown): string | undefined => {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }

  return typeof value === 'string' ? value : undefined;
};

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'veyra-stream-resolver',
    version: '1.0.0',
  });
});

app.get('/api/resolve', (req, res) => {
  const type = getQueryValue(req.query.type);
  const id = getQueryValue(req.query.id);

  if (!type || !id) {
    return res.status(400).json({
      error: 'type and id query parameters are required',
    });
  }

  return res.json({
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    referer: 'https://test-streams.mux.dev/',
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
