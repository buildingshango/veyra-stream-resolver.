import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MOVIES, IMovieInfo, IMovieResult } from '@consumet/extensions';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;
const fallbackUrl = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const flixhq = new MOVIES.FlixHQ();

const getQueryValue = (value: unknown): string | undefined => {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }

  return typeof value === 'string' ? value : undefined;
};

const getTitle = (title: IMovieResult['title']): string => {
  if (typeof title === 'string') {
    return title;
  }

  return title.english || title.userPreferred || title.romaji || title.native || '';
};

const getQuality = (quality: string | undefined): number => {
  const match = quality?.match(/(\d+)p/i);
  return match ? Number(match[1]) : 0;
};

const fetchTmdbTitle = async (type: string, id: string): Promise<string | undefined> => {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/${encodeURIComponent(type)}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      return undefined;
    }

    const metadata = (await response.json()) as { title?: string; name?: string };
    return metadata.title || metadata.name;
  } finally {
    clearTimeout(timeout);
  }
};

const findMovie = async (type: string, id: string): Promise<IMovieResult> => {
  const title = (await fetchTmdbTitle(type, id)) || id;
  const search = await flixhq.search(title);

  if (search.results.length === 0) {
    throw new Error('No FlixHQ results found');
  }

  const normalizedTitle = title.toLowerCase();
  return search.results.find((result) => getTitle(result.title).toLowerCase() === normalizedTitle)
    || search.results[0];
};

const resolveStream = async (
  type: string,
  id: string,
  season: string | undefined,
  episode: string | undefined,
): Promise<string> => {
  const result = await findMovie(type, id);
  const mediaInfo: IMovieInfo = await flixhq.fetchMediaInfo(result.id);
  const isTv = type.toLowerCase() === 'tv';
  const episodeNumber = episode ? Number(episode) : undefined;
  const seasonNumber = season ? Number(season) : undefined;
  const targetEpisode = isTv
    ? mediaInfo.seasons?.find((item) => item.season === seasonNumber)?.episodes.find(
      (item) => item.number === episodeNumber,
    )
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

app.use(cors());
app.use(express.json());

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
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Stream resolution timed out')), 15000);
      }),
    ]);

    return res.json({ url, referer: 'https://flixhq.to/' });
  } catch (error) {
    console.error('Stream resolution failed:', error);
    return res.json({ url: fallbackUrl });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
