"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = Number(process.env.PORT) || 3001;
const getQueryValue = (value) => {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return value[0];
    }
    return typeof value === 'string' ? value : undefined;
};
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
