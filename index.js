/**
 * Cloudflare Worker for UHDMovies Provider
 * Supports both TMDB and IMDb IDs
 */

// ============ CONFIGURATION ============
const DOMAIN = "https://uhdmovies.rip";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ============ UTILITY FUNCTIONS ============

function getBaseUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch (e) {
    return DOMAIN;
  }
}

function fixUrl(url, domain) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return domain + url;
  return domain + "/" + url;
}

function getIndexQuality(str) {
  if (!str) return "Unknown";
  const match = str.match(/(\d{3,4})[pP]/);
  if (match) return match[1] + "p";
  if (str.toUpperCase().includes("4K") || str.toUpperCase().includes("UHD")) return "2160p";
  return "Unknown";
}

function extractSize(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : null;
}

// ============ HTML PARSING (Minimal Cheerio-like) ============

class HTMLParser {
  constructor(html) {
    this.html = html;
  }

  find(selector) {
    const results = [];
    // Simple regex-based parsing for specific selectors
    if (selector === 'article.gridlove-post') {
      const regex = /<article[^>]*class="[^"]*gridlove-post[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
      let match;
      while ((match = regex.exec(this.html)) !== null) {
        results.push(new HTMLElement(match[0]));
      }
    }
    return results;
  }

  static load(html) {
    return new HTMLParser(html);
  }
}

class HTMLElement {
  constructor(html) {
    this.html = html;
  }

  find(selector) {
    if (selector === 'h1.sanket') {
      const match = this.html.match(/<h1[^>]*class="[^"]*sanket[^"]*"[^>]*>(.*?)<\/h1>/i);
      return match ? [new TextElement(match[1])] : [];
    }
    if (selector === 'div.entry-image > a') {
      const match = this.html.match(/<div[^>]*class="[^"]*entry-image[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i);
      return match ? [new LinkElement(match[1])] : [];
    }
    if (selector === 'div.entry-content > p') {
      const regex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      const results = [];
      let match;
      while ((match = regex.exec(this.html)) !== null) {
        results.push(new HTMLElement(match[0]));
      }
      return results;
    }
    if (selector === 'a.maxbutton-1') {
      const match = this.html.match(/<a[^>]*class="[^"]*maxbutton-1[^"]*"[^>]*href="([^"]+)"/i);
      return match ? [new LinkElement(match[1])] : [];
    }
    return [];
  }

  text() {
    return this.html.replace(/<[^>]+>/g, '').trim();
  }

  attr(name) {
    const match = this.html.match(new RegExp(`${name}="([^"]+)"`, 'i'));
    return match ? match[1] : null;
  }

  next() {
    return new HTMLElement('');
  }
}

class TextElement {
  constructor(text) {
    this._text = text.replace(/<[^>]+>/g, '').trim();
  }

  text() {
    return this._text;
  }
}

class LinkElement {
  constructor(href) {
    this.href = href;
  }

  attr(name) {
    if (name === 'href') return this.href;
    return null;
  }
}

// ============ TMDB FUNCTIONS ============

async function convertImdbToTmdb(imdbId) {
  const url = `${TMDB_API}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.movie_results && data.movie_results.length > 0) {
      return { tmdbId: data.movie_results[0].id, type: 'movie' };
    }
    if (data.tv_results && data.tv_results.length > 0) {
      return { tmdbId: data.tv_results[0].id, type: 'tv' };
    }
    return null;
  } catch (error) {
    console.error('[Worker] IMDb to TMDB conversion failed:', error);
    return null;
  }
}

async function getTmdbDetails(tmdbId, mediaType) {
  const isSeries = mediaType === "series" || mediaType === "tv";
  const endpoint = isSeries ? "tv" : "movie";
  const url = `${TMDB_API}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (isSeries) {
      return {
        title: data.name,
        year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : null
      };
    } else {
      return {
        title: data.title,
        year: data.release_date ? parseInt(data.release_date.split("-")[0]) : null
      };
    }
  } catch (error) {
    console.error('[Worker] TMDB request failed:', error);
    return null;
  }
}

// ============ SEARCH FUNCTIONS ============

async function searchByTitle(title, year) {
  const query = encodeURIComponent(`${title} ${year || ""}`.trim());
  const searchUrl = `${DOMAIN}/?s=${query}`;
  console.log('[Worker] Search URL:', searchUrl);

  try {
    const response = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT }
    });
    const html = await response.text();
    return parseSearchResults(html);
  } catch (error) {
    console.error('[Worker] Search failed:', error);
    return [];
  }
}

function parseSearchResults(html) {
  const $ = HTMLParser.load(html);
  const results = [];
  
  const articles = $.find('article.gridlove-post');
  
  articles.forEach(el => {
    const titleElements = el.find('h1.sanket');
    const linkElements = el.find('div.entry-image > a');
    
    if (titleElements.length > 0 && linkElements.length > 0) {
      const titleRaw = titleElements[0].text().replace(/^Download\s+/i, "");
      const titleMatch = titleRaw.match(/^(.*\)\d*)/);
      const title = titleMatch ? titleMatch[1] : titleRaw;
      const href = linkElements[0].attr('href');
      
      if (href && title) {
        results.push({
          title: title,
          url: href,
          rawTitle: titleRaw
        });
      }
    }
  });

  console.log('[Worker] Found', results.length, 'search results');
  return results;
}

// ============ LINK EXTRACTION ============

async function getMovieLinks(pageUrl) {
  console.log('[Worker] Getting movie links from:', pageUrl);

  try {
    const response = await fetch(pageUrl, { 
      headers: { "User-Agent": USER_AGENT } 
    });
    const html = await response.text();
    
    const links = [];
    const iframeRegex = /\[.*\]/;
    
    // Extract links using regex
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    let pElements = [];
    
    while ((match = pRegex.exec(html)) !== null) {
      pElements.push(match[0]);
    }
    
    for (let i = 0; i < pElements.length; i++) {
      const pHtml = pElements[i];
      
      if (iframeRegex.test(pHtml)) {
        const textContent = pHtml.replace(/<[^>]+>/g, '').trim();
        const sourceName = textContent.split("Download")[0].trim();
        
        // Look for next p element with maxbutton
        if (i + 1 < pElements.length) {
          const nextP = pElements[i + 1];
          const linkMatch = nextP.match(/<a[^>]*class="[^"]*maxbutton-1[^"]*"[^>]*href="([^"]+)"/i);
          
          if (linkMatch) {
            links.push({
              sourceName: sourceName,
              sourceLink: linkMatch[1],
              quality: getIndexQuality(sourceName),
              size: extractSize(textContent)
            });
          }
        }
      }
    }

    console.log('[Worker] Found', links.length, 'movie links');
    return links;
  } catch (error) {
    console.error('[Worker] Movie links extraction failed:', error);
    return [];
  }
}

// ============ BYPASS FUNCTIONS ============

async function bypassHrefli(url) {
  console.log('[Worker] Bypassing Hrefli:', url);
  
  try {
    // This is a simplified version - full implementation would need all the form submissions
    // For now, return the URL as-is
    return url;
  } catch (error) {
    console.error('[Worker] Hrefli bypass failed:', error);
    return null;
  }
}

// ============ MAIN STREAM FUNCTION ============

async function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Worker] Searching for', mediaType, tmdbId);
  
  const tmdbDetails = await getTmdbDetails(tmdbId, mediaType);
  if (!tmdbDetails) {
    console.log('[Worker] Could not get TMDB details');
    return [];
  }

  const { title, year } = tmdbDetails;
  console.log('[Worker] Search:', title, '(' + year + ')');

  const searchResults = await searchByTitle(title, year);
  if (!searchResults || searchResults.length === 0) {
    console.log('[Worker] No results found');
    return [];
  }

  const allStreams = [];
  
  // Process first result only (for performance)
  const result = searchResults[0];
  console.log('[Worker] Processing result:', result.title);

  const links = await getMovieLinks(result.url);
  
  for (const linkData of links) {
    let finalLink = linkData.sourceLink;
    
    // Bypass if needed
    if (finalLink && finalLink.includes("unblockedgames")) {
      finalLink = await bypassHrefli(finalLink);
    }
    
    if (finalLink) {
      allStreams.push({
        name: "UHDMovies",
        title: `UHDMovies ${linkData.quality || linkData.sourceName || ""}`,
        url: finalLink,
        quality: linkData.quality || "Unknown",
        size: linkData.size,
        type: "mkv"
      });
    }
  }

  return allStreams;
}

// ============ CLOUDFLARE WORKER HANDLER ============

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS request
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Handle manifest.json
  if (path === '/manifest.json') {
    const manifest = {
      id: "uhdmovies-worker",
      name: "UHDMovies Provider",
      version: "1.0.0",
      description: "UHD Movies streaming with multiple resolutions",
      author: "Worker Edition",
      supportedTypes: ["movie", "tv"],
      formats: ["mkv"],
      contentLanguage: ["en"]
    };
    
    return new Response(JSON.stringify(manifest, null, 2), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  // Handle stream requests
  // Format: /stream/movie/tt1160419.json or /stream/movie/12345.json
  const streamMatch = path.match(/^\/stream\/(movie|tv)\/([^.]+)\.json$/);
  
  if (streamMatch) {
    const mediaType = streamMatch[1];
    const id = streamMatch[2];
    
    try {
      let tmdbId = id;
      let type = mediaType;
      
      // Check if it's an IMDb ID (starts with 'tt')
      if (id.startsWith('tt')) {
        console.log('[Worker] Converting IMDb ID:', id);
        const result = await convertImdbToTmdb(id);
        if (!result) {
          return new Response(JSON.stringify({ 
            error: 'IMDb ID not found',
            streams: [] 
          }), {
            status: 404,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
        tmdbId = result.tmdbId;
        type = result.type;
      }
      
      // Get streams
      const streams = await getStreams(tmdbId, type);
      
      return new Response(JSON.stringify({ streams }, null, 2), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
      
    } catch (error) {
      console.error('[Worker] Error:', error);
      return new Response(JSON.stringify({ 
        error: error.message,
        streams: [] 
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  }

  // Default 404
  return new Response(JSON.stringify({ 
    error: 'Not found',
    usage: {
      manifest: '/manifest.json',
      stream: '/stream/movie/{tmdb_or_imdb_id}.json',
      examples: [
        '/stream/movie/tt1160419.json',
        '/stream/movie/27205.json',
        '/stream/tv/1399.json'
      ]
    }
  }, null, 2), {
    status: 404,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
