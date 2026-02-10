/**
 * UHDMovies Cloudflare Worker - Client-Side Bypass Version
 * Returns bypass instructions instead of performing bypass server-side
 * This avoids Cloudflare timeout issues
 */

const DOMAIN = "https://uhdmovies.rip";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// Alternative: Bypass API endpoint (if you want to run bypass separately)
const BYPASS_API = "https://api.bypass.workers.dev/hrefli"; // You can create this

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
    return null;
  }
}

async function searchByTitle(title, year) {
  const query = encodeURIComponent(`${title} ${year || ""}`.trim());
  const searchUrl = `${DOMAIN}/?s=${query}`;

  try {
    const response = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT }
    });
    const html = await response.text();
    return parseSearchResults(html);
  } catch (error) {
    return [];
  }
}

function parseSearchResults(html) {
  const results = [];
  const articleRegex = /<article[^>]*class="[^"]*gridlove-post[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  
  while ((match = articleRegex.exec(html)) !== null) {
    const articleHtml = match[1];
    const titleMatch = articleHtml.match(/<h1[^>]*class="[^"]*sanket[^"]*"[^>]*>(.*?)<\/h1>/i);
    if (!titleMatch) continue;
    
    const titleRaw = titleMatch[1].replace(/<[^>]+>/g, '').trim().replace(/^Download\s+/i, "");
    const titleClean = titleRaw.match(/^(.*\)\d*)/);
    const title = titleClean ? titleClean[1] : titleRaw;
    
    const urlMatch = articleHtml.match(/<a[^>]*href="([^"]+)"/);
    if (!urlMatch) continue;
    
    results.push({
      title: title,
      url: urlMatch[1]
    });
  }

  return results;
}

async function getMovieLinks(pageUrl) {
  try {
    const response = await fetch(pageUrl, { 
      headers: { "User-Agent": USER_AGENT } 
    });
    const html = await response.text();
    
    const links = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatches = [];
    let pMatch;
    
    while ((pMatch = pRegex.exec(html)) !== null) {
      pMatches.push(pMatch[0]);
    }
    
    for (let i = 0; i < pMatches.length; i++) {
      const pHtml = pMatches[i];
      
      if (/\[.*\]/.test(pHtml)) {
        const textContent = pHtml.replace(/<[^>]+>/g, '').trim();
        const sourceName = textContent.split("Download")[0].trim();
        
        if (i + 1 < pMatches.length) {
          const nextP = pMatches[i + 1];
          const linkMatch = nextP.match(/<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"/i);
          
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

    return links;
  } catch (error) {
    return [];
  }
}

async function getStreams(tmdbId, mediaType) {
  const tmdbDetails = await getTmdbDetails(tmdbId, mediaType);
  if (!tmdbDetails) return [];

  const { title, year } = tmdbDetails;
  const searchResults = await searchByTitle(title, year);
  if (!searchResults || searchResults.length === 0) return [];

  const allStreams = [];
  const result = searchResults[0];
  const links = await getMovieLinks(result.url);
  
  for (const linkData of links) {
    const sourceLink = linkData.sourceLink;
    
    // Detect if bypass is needed
    const needsBypass = sourceLink && sourceLink.includes("unblockedgames");
    
    allStreams.push({
      name: "UHDMovies",
      title: `UHDMovies ${linkData.quality || linkData.sourceName || ""}`,
      url: sourceLink,
      quality: linkData.quality || "Unknown",
      size: linkData.size,
      type: "mkv",
      // Bypass metadata
      needsBypass: needsBypass,
      bypassType: needsBypass ? "hrefli" : null,
      // If you have a separate bypass API:
      bypassUrl: needsBypass ? `${BYPASS_API}?url=${encodeURIComponent(sourceLink)}` : null,
      // Instructions for client-side bypass
      bypassInstructions: needsBypass ? {
        type: "hrefli",
        steps: [
          "1. Fetch the URL with User-Agent",
          "2. Extract form#landing action and inputs",
          "3. Submit form data twice",
          "4. Extract ?go= token from script",
          "5. Request with token as cookie",
          "6. Follow meta refresh URL",
          "7. Extract final redirect path"
        ],
        requiredHeaders: {
          "User-Agent": USER_AGENT
        }
      } : null
    });
  }

  return allStreams;
}

// ============ SEPARATE BYPASS ENDPOINT ============

async function performBypass(encodedUrl) {
  // This is a dedicated endpoint for bypass
  // Can have longer timeout limits
  const host = encodedUrl.match(/https?:\/\/[^\/]+/)?.[0];
  
  try {
    // Step 1
    const resp1 = await fetch(encodedUrl, { 
      headers: { "User-Agent": USER_AGENT }
    });
    const html1 = await resp1.text();
    const formAction1 = html1.match(/<form[^>]*id="landing"[^>]*action="([^"]+)"/i)?.[1];
    if (!formAction1) return { error: "No form found" };
    
    const formData1 = {};
    const inputRegex = /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
    let match;
    while ((match = inputRegex.exec(html1)) !== null) {
      formData1[match[1]] = match[2];
    }
    
    // Step 2
    const resp2 = await fetch(formAction1, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(formData1).toString()
    });
    const html2 = await resp2.text();
    
    const formAction2 = html2.match(/<form[^>]*id="landing"[^>]*action="([^"]+)"/i)?.[1];
    if (!formAction2) return { error: "No second form" };
    
    const formData2 = {};
    const inputRegex2 = /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
    while ((match = inputRegex2.exec(html2)) !== null) {
      formData2[match[1]] = match[2];
    }
    const wpHttp2 = formData2["_wp_http2"] || "";
    
    // Step 3
    const resp3 = await fetch(formAction2, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(formData2).toString()
    });
    const html3 = await resp3.text();
    
    const goToken = html3.match(/\?go=([^"'\s&]+)/)?.[1];
    if (!goToken) return { error: "No go token" };
    
    // Step 4
    const resp4 = await fetch(`${host}?go=${goToken}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": `${goToken}=${wpHttp2}`
      }
    });
    const html4 = await resp4.text();
    
    const metaUrl = html4.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s]+)/i)?.[1];
    if (!metaUrl) return { error: "No meta refresh" };
    
    // Step 5
    const resp5 = await fetch(metaUrl, { 
      headers: { "User-Agent": USER_AGENT }
    });
    const html5 = await resp5.text();
    
    const redirectPath = html5.match(/replace\(["']([^"']+)["']\)/)?.[1];
    if (!redirectPath || redirectPath === "/404") return { error: "No redirect path" };
    
    const finalUrl = redirectPath.startsWith('http') 
      ? redirectPath 
      : metaUrl.match(/https?:\/\/[^\/]+/)?.[0] + redirectPath;
    
    return { success: true, url: finalUrl };
    
  } catch (error) {
    return { error: error.message };
  }
}

// ============ WORKER HANDLER ============

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

  if (path === '/manifest.json') {
    return new Response(JSON.stringify({
      id: "uhdmovies-client-bypass",
      name: "UHDMovies (Client Bypass)",
      version: "3.0.0",
      description: "Returns bypass instructions for client-side processing"
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Dedicated bypass endpoint
  if (path === '/bypass') {
    const encodedUrl = url.searchParams.get('url');
    if (!encodedUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const result = await performBypass(encodedUrl);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const streamMatch = path.match(/^\/stream\/(movie|tv)\/([^.]+)\.json$/);
  
  if (streamMatch) {
    const mediaType = streamMatch[1];
    const id = streamMatch[2];
    
    try {
      let tmdbId = id;
      let type = mediaType;
      
      if (id.startsWith('tt')) {
        const result = await convertImdbToTmdb(id);
        if (!result) {
          return new Response(JSON.stringify({ 
            error: 'IMDb ID not found',
            streams: [] 
          }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        tmdbId = result.tmdbId;
        type = result.type;
      }
      
      const streams = await getStreams(tmdbId, type);
      
      return new Response(JSON.stringify({ streams }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ 
        error: error.message,
        streams: [] 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ 
    error: 'Not found',
    endpoints: {
      manifest: '/manifest.json',
      stream: '/stream/movie/{id}.json',
      bypass: '/bypass?url={encoded_url}'
    },
    examples: {
      stream: '/stream/movie/tt1160419.json',
      bypass: '/bypass?url=https://tech.unblockedgames.world/?sid=...'
    }
  }, null, 2), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
