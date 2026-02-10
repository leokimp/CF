/**
 * UHDMovies Cloudflare Worker - Full Implementation
 * With bypass support and lightweight HTML parsing
 */

const DOMAIN = "https://uhdmovies.rip";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// ============ LIGHTWEIGHT HTML PARSER ============

class SimpleParser {
  static getText(html, selector) {
    // Extract text content from HTML element
    const regex = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)</${selector}>`, 'i');
    const match = html.match(regex);
    return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
  }

  static getAttr(html, tag, className, attr) {
    const classPattern = className ? `class="[^"]*${className}[^"]*"` : '';
    const regex = new RegExp(`<${tag}[^>]*${classPattern}[^>]*${attr}="([^"]+)"`, 'i');
    const match = html.match(regex);
    return match ? match[1] : null;
  }

  static findAll(html, pattern) {
    const results = [];
    const regex = new RegExp(pattern, 'gi');
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push(match);
    }
    return results;
  }

  static getFormData(html) {
    const formData = {};
    const inputs = this.findAll(html, '<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>');
    inputs.forEach(match => {
      formData[match[1]] = match[2] || '';
    });
    return formData;
  }
}

// ============ UTILITY FUNCTIONS ============

function getBaseUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch (e) {
    return DOMAIN;
  }
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

// ============ HREFLI BYPASS (Simplified for Cloudflare) ============

async function bypassHrefli(url) {
  const host = getBaseUrl(url);
  console.log('[Worker] Bypassing Hrefli:', url);

  try {
    // Step 1: Get initial page
    const response1 = await fetch(url, { 
      headers: { "User-Agent": USER_AGENT },
      redirect: 'manual'
    });
    const html1 = await response1.text();
    
    // Extract form data
    const formUrl1 = SimpleParser.getAttr(html1, 'form', 'landing', 'action');
    if (!formUrl1) return null;
    
    const formData1 = SimpleParser.getFormData(html1);
    
    // Step 2: First form submission
    const response2 = await fetch(formUrl1, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(formData1).toString(),
      redirect: 'manual'
    });
    const html2 = await response2.text();
    
    // Step 3: Second form submission
    const formUrl2 = SimpleParser.getAttr(html2, 'form', 'landing', 'action');
    if (!formUrl2) return null;
    
    const formData2 = SimpleParser.getFormData(html2);
    const wpHttp2 = formData2["_wp_http2"] || "";
    
    const response3 = await fetch(formUrl2, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(formData2).toString(),
      redirect: 'manual'
    });
    const html3 = await response3.text();
    
    // Step 4: Extract token
    const scriptMatch = html3.match(/\?go=([^"]+)/);
    if (!scriptMatch) return null;
    const skToken = scriptMatch[1];
    
    // Step 5: Get with token cookie
    const response4 = await fetch(`${host}?go=${skToken}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": `${skToken}=${wpHttp2}`
      },
      redirect: 'manual'
    });
    const html4 = await response4.text();
    
    // Step 6: Extract meta refresh URL
    const metaMatch = html4.match(/<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^"]+)"/i);
    if (!metaMatch) return null;
    const driveUrl = metaMatch[1];
    
    // Step 7: Follow to final URL
    const response5 = await fetch(driveUrl, { 
      headers: { "User-Agent": USER_AGENT },
      redirect: 'manual'
    });
    const html5 = await response5.text();
    
    const pathMatch = html5.match(/replace\("([^"]+)"\)/);
    if (!pathMatch || pathMatch[1] === "/404") return null;
    
    const finalUrl = pathMatch[1].startsWith('http') 
      ? pathMatch[1] 
      : getBaseUrl(driveUrl) + pathMatch[1];
    
    console.log('[Worker] Bypass successful:', finalUrl);
    return finalUrl;
    
  } catch (error) {
    console.error('[Worker] Bypass failed:', error.message);
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
    console.error('[Worker] IMDb conversion failed:', error);
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
  const results = [];
  
  // Find all article elements
  const articles = SimpleParser.findAll(html, '<article[^>]*class="[^"]*gridlove-post[^"]*"[^>]*>([\\s\\S]*?)</article>');
  
  articles.forEach(match => {
    const articleHtml = match[1];
    
    // Extract title
    const titleMatch = articleHtml.match(/<h1[^>]*class="[^"]*sanket[^"]*"[^>]*>(.*?)<\/h1>/i);
    if (!titleMatch) return;
    
    const titleRaw = titleMatch[1].replace(/<[^>]+>/g, '').trim().replace(/^Download\s+/i, "");
    const titleClean = titleRaw.match(/^(.*\)\d*)/);
    const title = titleClean ? titleClean[1] : titleRaw;
    
    // Extract URL
    const urlMatch = articleHtml.match(/<div[^>]*class="[^"]*entry-image[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i);
    if (!urlMatch) return;
    
    const href = urlMatch[1];
    
    if (href && title) {
      results.push({
        title: title,
        url: href,
        rawTitle: titleRaw
      });
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
    
    // Find all <p> tags in entry-content
    const pElements = SimpleParser.findAll(html, '<p[^>]*>([\\s\\S]*?)</p>');
    
    for (let i = 0; i < pElements.length; i++) {
      const pHtml = pElements[i][0];
      const pContent = pElements[i][1];
      
      if (iframeRegex.test(pHtml)) {
        const textContent = pContent.replace(/<[^>]+>/g, '').trim();
        const sourceName = textContent.split("Download")[0].trim();
        
        // Look for next element with maxbutton
        if (i + 1 < pElements.length) {
          const nextP = pElements[i + 1][0];
          const linkMatch = nextP.match(/<a[^>]*class="[^"]*maxbutton-1[^"]*"[^>]*href="([^"]+)"/i);
          
          if (linkMatch) {
            const quality = getIndexQuality(sourceName);
            const size = extractSize(textContent);
            
            links.push({
              sourceName: sourceName,
              sourceLink: linkMatch[1],
              quality: quality,
              size: size
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
  
  // Process first 2 results (balance between coverage and timeout)
  const resultsToProcess = searchResults.slice(0, 2);
  
  for (const result of resultsToProcess) {
    console.log('[Worker] Processing result:', result.title);

    const links = await getMovieLinks(result.url);
    
    for (const linkData of links) {
      let finalLink = linkData.sourceLink;
      
      // Bypass if needed
      if (finalLink && finalLink.includes("unblockedgames")) {
        console.log('[Worker] Attempting bypass for:', finalLink);
        const bypassed = await bypassHrefli(finalLink);
        if (bypassed) {
          finalLink = bypassed;
        } else {
          console.log('[Worker] Bypass failed, using original link');
          // Continue with original link instead of skipping
        }
      }
      
      if (finalLink) {
        allStreams.push({
          name: "UHDMovies",
          title: `UHDMovies ${linkData.quality || linkData.sourceName || ""}`,
          url: finalLink,
          quality: linkData.quality || "Unknown",
          size: linkData.size,
          type: "mkv",
          bypassed: !finalLink.includes("unblockedgames")
        });
      }
    }
    
    // If we found streams, don't process more results
    if (allStreams.length > 0) break;
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

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Manifest
  if (path === '/manifest.json') {
    const manifest = {
      id: "uhdmovies-worker",
      name: "UHDMovies Provider",
      version: "2.0.0",
      description: "UHD Movies streaming with bypass support",
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

  // Stream requests
  const streamMatch = path.match(/^\/stream\/(movie|tv)\/([^.]+)\.json$/);
  
  if (streamMatch) {
    const mediaType = streamMatch[1];
    const id = streamMatch[2];
    
    try {
      let tmdbId = id;
      let type = mediaType;
      
      // Convert IMDb ID if needed
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
        '/stream/movie/27205.json'
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
