import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MOVIES, IMovieInfo, IMovieResult } from '@consumet/extensions';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;
const fallbackUrl = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const flixhq = new MOVIES.FlixHQ();
type StreamTarget = { url: string; referer: string };

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Stream resolution timed out')), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
};

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

const getEdgeTargets = (
  type: string,
  id: string,
  season: string | undefined,
  episode: string | undefined,
): StreamTarget[] => {
  const isTv = type.toLowerCase() === 'tv';
  const tvPath = `${id}/${season || 1}/${episode || 1}`;

  return [
    {
      url: `https://vidsrc.cc/v2/embed/${isTv ? `tv/${tvPath}` : `movie/${id}`}`,
      referer: 'https://vidsrc.cc/',
    },
    {
      url: `https://vidlink.pro/${isTv ? `tv/${tvPath}` : `movie/${id}`}`,
      referer: 'https://vidlink.pro/',
    },
  ];
};

const probeEdgeTarget = async (target: StreamTarget): Promise<StreamTarget> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(target.url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 301 && response.status !== 302) {
      throw new Error(`Edge provider returned ${response.status}`);
    }

    return target;
  } finally {
    clearTimeout(timeout);
  }
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

const resolveMultiProvider = async (
  type: string,
  id: string,
  season: string | undefined,
  episode: string | undefined,
): Promise<StreamTarget> => {
  for (const target of getEdgeTargets(type, id, season, episode)) {
    try {
      return await probeEdgeTarget(target);
    } catch {
      continue;
    }
  }

  return {
    url: await resolveStream(type, id, season, episode),
    referer: 'https://flixhq.to/',
  };
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

  console.log(`[Resolver] Resolving type=${type}, id=${id}`);

  try {
    const target = await withTimeout(resolveMultiProvider(type, id, season, episode), 5000);

    return res.json(target);
  } catch {
    console.warn('[Resolver Warning] Scraper timed out or blocked by host. Using secondary stream proxy.');
    return res.json({
      url: fallbackUrl,
      referer: 'https://test-streams.mux.dev/',
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
