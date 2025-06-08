const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('=== Screen Recorder Pro API Called ===');
  console.log('Method:', event.httpMethod);
  console.log('Environment check - API key present:', !!process.env.SCREENSHOTONE_API_KEY);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Plugin-License, User-Agent',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS preflight successful' }) };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method not allowed. Use POST.' })
    };
  }

  try {
    // Check environment variables first
    if (!process.env.SCREENSHOTONE_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: 'Server configuration error: ScreenshotOne API key not configured',
          error: 'MISSING_API_KEY'
        })
      };
    }

    const requestData = JSON.parse(event.body || '{}');
    const { url, options, license_key, site_url } = requestData;

    const licenseHeader = event.headers['x-plugin-license'] || license_key || 'free';

    console.log('=== Request Details ===');
    console.log('Target URL:', url);
    console.log('Duration requested:', options?.duration);

    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'URL is required' })
      };
    }

    // Validate license and determine plan limits
    const licenseCheck = await validateLicense(licenseHeader, site_url);
    if (!licenseCheck.valid) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: licenseCheck.message })
      };
    }

    // IMPORTANT: Enforce duration limits based on Netlify tier
    const maxDuration = getMaxDurationForPlan(licenseCheck.plan);
    const requestedDuration = parseInt(options?.duration || '3');

    if (requestedDuration > maxDuration) {
      console.log(`❌ Duration ${requestedDuration}s exceeds limit of ${maxDuration}s for plan ${licenseCheck.plan}`);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: `Recording duration limited to ${maxDuration} seconds on current plan. Upgrade for longer recordings.`,
          error: 'DURATION_LIMIT_EXCEEDED',
          max_duration: maxDuration,
          requested_duration: requestedDuration
        })
      };
    }

    // Use the safe duration (capped at limits)
    const safeDuration = Math.min(requestedDuration, maxDuration);

    console.log(`✅ Using duration: ${safeDuration}s (max allowed: ${maxDuration}s)`);

    // Create recording with safe duration
    const recordingResult = await callScreenshotOneAPI(url, {
      ...options,
      duration: safeDuration.toString() // Override with safe duration
    });

    if (recordingResult.success) {
      await incrementUsage(licenseHeader, site_url, url);

      console.log('✅ Recording created successfully');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          video_data: recordingResult.video_data,
          file_size: recordingResult.file_size,
          duration: safeDuration,
          actual_duration: recordingResult.actual_duration,
          message: `Recording created successfully (${safeDuration}s)`
        })
      };
    } else {
      console.log('❌ Recording failed:', recordingResult.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: 'Failed to create recording: ' + recordingResult.error
        })
      };
    }

  } catch (error) {
    console.error('❌ Unexpected Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error: ' + error.message
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