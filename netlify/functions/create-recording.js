const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Set a 9-second timeout for the entire function
  context.callbackWaitsForEmptyEventLoop = false;

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method not allowed' })
    };
  }

  try {
    const { url, options, license_key, site_url } = JSON.parse(event.body);

    console.log('Received options:', JSON.stringify(options, null, 2));

    // Use the optimized timeout from WordPress
    const apiTimeout = options.timeout || 6; // Default to 6 seconds
    const scrollDuration = options.scroll_duration || 800; // Use optimized scroll duration

    console.log(`Using API timeout: ${apiTimeout}s, scroll duration: ${scrollDuration}ms`);

    // Build ScreenshotOne API URL with optimized parameters
    const screenshotOneUrl = 'https://api.screenshotone.com/animate?' + new URLSearchParams({
      access_key: process.env.SCREENSHOTONE_API_KEY || 'V3mF4QholiL8Qw',
      url: url,
      format: options.format || 'mp4',
      duration: Math.min(options.duration || 5, 5), // Cap at 5 seconds
      scenario: 'scroll',
      viewport_width: options.viewport_width || 820,
      viewport_height: options.viewport_height || 1180,
      viewport_mobile: options.device_type === 'mobile' ? 'true' : 'false',

      // Use optimized timeout and scroll settings
      timeout: apiTimeout, // Use the optimized timeout
      scroll_duration: scrollDuration, // Use optimized scroll duration
      scroll_start_immediately: 'true',
      scroll_complete: 'true',

      // Performance optimizations
      block_ads: 'true',
      block_cookie_banners: 'true',
      block_trackers: 'true',
      wait_for_network_idle: options.wait_for_network_idle ? 'true' : 'false',
      delay: options.delay || 0,
    });

    console.log('ScreenshotOne URL:', screenshotOneUrl);

    // Make request with timeout matching our API timeout + 1 second buffer
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), (apiTimeout + 1) * 1000);

    const response = await fetch(screenshotOneUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ScreenRecorderPro-Netlify/1.0'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('ScreenshotOne API error:', response.status, response.statusText);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          message: `ScreenshotOne API error: ${response.status} ${response.statusText}`
        })
      };
    }

    // Get the video data
    const videoBuffer = await response.arrayBuffer();
    const videoBase64 = Buffer.from(videoBuffer).toString('base64');

    console.log(`Video created successfully. Size: ${videoBuffer.byteLength} bytes`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        video_data: videoBase64,
        duration: options.duration || 5,
        format: options.format || 'mp4',
        size: videoBuffer.byteLength
      })
    };

  } catch (error) {
    console.error('Function error:', error);

    // Handle different types of errors
    let errorMessage = 'Unknown error occurred';

    if (error.name === 'AbortError') {
      errorMessage = `Request timed out after ${apiTimeout || 6} seconds. Try reducing the duration or using a simpler page.`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: `Failed to create recording: ${errorMessage}`
      })
    };
  }
};

// Get maximum recording duration based on plan and Netlify limits
function getMaxDurationForPlan(plan) {
  // Netlify Free tier: 10s execution limit
  // We need to leave ~2-3 seconds for processing, API calls, etc.
  const netlifyLimits = {
    'free': 5,      // 5 seconds max for free users (safe within 10s limit)
    'starter': 7,   // 7 seconds for starter (still within 10s limit)
    'pro': 7,       // 7 seconds until we upgrade Netlify account
    'agency': 7     // 7 seconds until we upgrade Netlify account
  };

  return netlifyLimits[plan] || netlifyLimits['free'];
}

async function validateLicense(licenseKey, siteUrl) {
  if (licenseKey === 'free' || !licenseKey || licenseKey.length < 5) {
    return { valid: true, plan: 'free' };
  }

  if (licenseKey.length >= 10) {
    return { valid: true, plan: 'starter' };
  }

  return { valid: false, message: 'Invalid license key format' };
}

async function callScreenshotOneAPI(url, options) {
  const screenshotOneKey = process.env.SCREENSHOTONE_API_KEY;

  if (!screenshotOneKey) {
    return { success: false, error: 'ScreenshotOne API key not configured' };
  }

  try {
    // Use shorter timeout to fit within Netlify's 10s limit
    const duration = options.duration || '5';
    const apiTimeout = '8'; // Max 8 seconds for ScreenshotOne

    const params = new URLSearchParams({
      access_key: screenshotOneKey,
      url: url,
      scenario: 'scroll',
      format: options.format || 'mp4',
      duration: duration,
      scroll_duration: '1000', // Reduced from 1500
      scroll_start_immediately: 'true',
      scroll_complete: 'true',
      viewport_width: options.viewport_width || '414',
      viewport_height: options.viewport_height || '896',
      viewport_mobile: options.device_type === 'mobile' ? 'true' : 'false',
      block_ads: 'true',
      block_cookie_banners: 'true',
      block_trackers: 'true',
      timeout: apiTimeout
    });

    const apiUrl = `https://api.screenshotone.com/animate?${params}`;

    console.log('Calling ScreenshotOne with duration:', duration, 'timeout:', apiTimeout);

    const startTime = Date.now();

    // Set aggressive timeout to stay within Netlify limits
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'ScreenRecorderPro-API/1.0' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const endTime = Date.now();
    const apiDuration = (endTime - startTime) / 1000;

    console.log('ScreenshotOne response status:', response.status, 'took:', apiDuration.toFixed(2) + 's');

    if (response.ok) {
      const videoBuffer = await response.buffer();
      console.log('✅ Video received:', videoBuffer.length, 'bytes');

      if (videoBuffer.length === 0) {
        return { success: false, error: 'ScreenshotOne returned empty response' };
      }

      const videoBase64 = videoBuffer.toString('base64');

      return {
        success: true,
        video_data: videoBase64,
        file_size: videoBuffer.length,
        duration: parseInt(duration),
        actual_duration: apiDuration
      };
    } else {
      const errorText = await response.text();
      return {
        success: false,
        error: `ScreenshotOne API failed with status ${response.status}: ${errorText}`
      };
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'ScreenshotOne API request timed out (8 seconds)' };
    }

    return { success: false, error: `Network error: ${error.message}` };
  }
}

async function incrementUsage(licenseKey, siteUrl, targetUrl) {
  const timestamp = new Date().toISOString();
  console.log('📊 Usage tracked:', timestamp, licenseKey?.substring(0, 8) + '...', siteUrl);
}