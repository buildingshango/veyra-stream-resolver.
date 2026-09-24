"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const extensions_1 = require("@consumet/extensions");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = Number(process.env.PORT) || 3001;
const fallbackUrl = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const flixhq = new extensions_1.MOVIES.FlixHQ();
const getQueryValue = (value) => {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return value[0];
    }
    return typeof value === 'string' ? value : undefined;
};
const getTitle = (title) => {
    if (typeof title === 'string') {
        return title;
    }
    return title.english || title.userPreferred || title.romaji || title.native || '';
};
const getQuality = (quality) => {
    const match = quality?.match(/(\d+)p/i);
    return match ? Number(match[1]) : 0;
};
const fetchTmdbTitle = async (type, id) => {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
        return undefined;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`https://api.themoviedb.org/3/${encodeURIComponent(type)}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(apiKey)}`, { signal: controller.signal });
        if (!response.ok) {
            return undefined;
        }
        const metadata = (await response.json());
        return metadata.title || metadata.name;
    }
    finally {
        clearTimeout(timeout);
    }
};
const findMovie = async (type, id) => {
    const title = (await fetchTmdbTitle(type, id)) || id;
    const search = await flixhq.search(title);
    if (search.results.length === 0) {
        throw new Error('No FlixHQ results found');
    }
    const normalizedTitle = title.toLowerCase();
    return search.results.find((result) => getTitle(result.title).toLowerCase() === normalizedTitle)
        || search.results[0];
};
const resolveStream = async (type, id, season, episode) => {
    const result = await findMovie(type, id);
    const mediaInfo = await flixhq.fetchMediaInfo(result.id);
    const isTv = type.toLowerCase() === 'tv';
    const episodeNumber = episode ? Number(episode) : undefined;
    const seasonNumber = season ? Number(season) : undefined;
    const targetEpisode = isTv
        ? mediaInfo.seasons?.find((item) => item.season === seasonNumber)?.episodes.find((item) => item.number === episodeNumber)
        : mediaInfo.episodes?.[0];
    if (!targetEpisode) {
        throw new Error('Target episode not found');
    }
    const sourceResponse = await flixhq.fetchEpisodeSources(targetEpisode.id, mediaInfo.id);
    const hlsSources = sourceResponse.sources
        .filter((source) => source.isM3U8 || source.url.toLowerCase().includes('.m3u8'))
        .sort((left, right) => getQuality(right.quality) - getQuality(left.quality));
    if (hlsSources.length === 0) {
        throw new Error('No HLS source found');
    }
    return hlsSources[0].url;
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
app.get('/api/resolve', async (req, res) => {
    const type = getQueryValue(req.query.type);
    const id = getQueryValue(req.query.id);
    const season = getQueryValue(req.query.season);
    const episode = getQueryValue(req.query.episode);
    if (!type || !id) {
        return res.status(400).json({
            error: 'type and id query parameters are required',
        });
    }
    if (type.toLowerCase() === 'tv' && (!season || !episode)) {
        return res.status(400).json({
            error: 'season and episode query parameters are required for TV shows',
        });
    }
    try {
        const url = await Promise.race([
            resolveStream(type, id, season, episode),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Stream resolution timed out')), 15000);
            }),
        ]);
        return res.json({ url, referer: 'https://flixhq.to/' });
    }
    catch (error) {
        console.error('Stream resolution failed:', error);
        return res.json({ url: fallbackUrl });
    }
});
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
