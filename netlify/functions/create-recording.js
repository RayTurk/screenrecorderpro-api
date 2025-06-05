// netlify/functions/create-recording.js
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

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    console.log('CORS preflight request');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight successful' })
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    console.log('Invalid method:', event.httpMethod);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method not allowed. Use POST.' })
    };
  }

  try {
    console.log('=== Request Processing Started ===');

    // Check environment variables first
    if (!process.env.SCREENSHOTONE_API_KEY) {
      console.error('❌ SCREENSHOTONE_API_KEY environment variable not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: 'Server configuration error: ScreenshotOne API key not configured',
          error: 'MISSING_API_KEY'
        })
      };
    }

    console.log('✅ ScreenshotOne API key found');
    console.log('Raw request body length:', event.body ? event.body.length : 0);

    // Parse request data
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('❌ JSON parse error:', parseError.message);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'Invalid JSON in request body',
          error: 'JSON_PARSE_ERROR'
        })
      };
    }

    const { url, options, license_key, site_url, user_id, plugin_version } = requestData;

    // Get license from headers (WordPress sends it here)
    const licenseHeader = event.headers['x-plugin-license'] || license_key || 'free';

    console.log('=== Request Details ===');
    console.log('License key:', licenseHeader ? 'present' : 'missing');
    console.log('Site URL:', site_url);
    console.log('Target URL:', url);
    console.log('Plugin version:', plugin_version);
    console.log('Options:', JSON.stringify(options, null, 2));

    // Validate required fields
    if (!url) {
      console.error('❌ No URL provided');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'URL is required',
          error: 'MISSING_URL'
        })
      };
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (urlError) {
      console.error('❌ Invalid URL format:', url);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'Invalid URL format',
          error: 'INVALID_URL'
        })
      };
    }

    // Validate license and check usage limits
    console.log('=== License Validation ===');
    const licenseCheck = await validateLicense(licenseHeader, site_url);

    if (!licenseCheck.valid) {
      console.log('❌ License validation failed:', licenseCheck.message);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: licenseCheck.message,
          error: 'INVALID_LICENSE'
        })
      };
    }
    console.log('✅ License valid for plan:', licenseCheck.plan);

    // Check usage limits
    console.log('=== Usage Check ===');
    const usageCheck = await checkUsageLimits(licenseHeader, licenseCheck.plan);

    if (!usageCheck.can_create) {
      console.log('❌ Usage limit exceeded:', usageCheck.message);
      return {
        statusCode: 402,
        headers,
        body: JSON.stringify({
          message: usageCheck.message,
          current_usage: usageCheck.current_usage,
          limit: usageCheck.limit,
          error: 'USAGE_LIMIT_EXCEEDED'
        })
      };
    }
    console.log('✅ Usage check passed:', usageCheck.current_usage + '/' + usageCheck.limit);

    // Create recording with ScreenshotOne
    console.log('=== Creating Recording ===');
    const recordingResult = await callScreenshotOneAPI(url, options);

    if (recordingResult.success) {
      // Track usage
      await incrementUsage(licenseHeader, site_url, url);

      console.log('✅ Recording created successfully');
      console.log('Video size:', recordingResult.file_size, 'bytes');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          video_data: recordingResult.video_data,
          file_size: recordingResult.file_size,
          duration: recordingResult.duration,
          message: 'Recording created successfully'
        })
      };
    } else {
      console.log('❌ Recording failed:', recordingResult.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: 'Failed to create recording: ' + recordingResult.error,
          error: 'SCREENSHOTONE_ERROR'
        })
      };
    }

  } catch (error) {
    console.error('❌ Unexpected Error:', error);
    console.error('Error stack:', error.stack);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error: ' + error.message,
        error: 'INTERNAL_ERROR',
        stack: error.stack
      })
    };
  }
};

// Validate license function
async function validateLicense(licenseKey, siteUrl) {
  console.log('Validating license...');

  try {
    // Free users
    if (licenseKey === 'free' || !licenseKey || licenseKey.length < 5) {
      return {
        valid: true,
        plan: 'free',
        site_url: siteUrl
      };
    }

    // Simple validation for now - any decent length key is considered paid
    if (licenseKey.length >= 10) {
      return {
        valid: true,
        plan: 'starter',
        site_url: siteUrl
      };
    }

    return {
      valid: false,
      message: 'Invalid license key format'
    };
  } catch (error) {
    console.error('License validation error:', error);
    return {
      valid: false,
      message: 'License validation failed'
    };
  }
}

// Check usage limits
async function checkUsageLimits(licenseKey, plan) {
  console.log('Checking usage limits...');

  try {
    const limits = {
      'free': { type: 'total', limit: 1 },
      'starter': { type: 'monthly', limit: 50 },
      'pro': { type: 'monthly', limit: 200 },
      'agency': { type: 'monthly', limit: 500 }
    };

    const planLimits = limits[plan] || limits['free'];
    let currentUsage = 0;

    // For now, always allow creation (WordPress handles the actual limit checking)
    const canCreate = true;

    console.log(`Usage: ${currentUsage}/${planLimits.limit} for plan "${plan}"`);

    return {
      can_create: canCreate,
      current_usage: currentUsage,
      limit: planLimits.limit,
      message: canCreate ? 'Usage OK' : `Usage limit reached (${currentUsage}/${planLimits.limit})`
    };
  } catch (error) {
    console.error('Usage check error:', error);
    return {
      can_create: false,
      current_usage: 0,
      limit: 1,
      message: 'Usage check failed'
    };
  }
}

// Call ScreenshotOne API
async function callScreenshotOneAPI(url, options) {
  const screenshotOneKey = process.env.SCREENSHOTONE_API_KEY;

  console.log('=== ScreenshotOne API Call ===');
  console.log('API key configured:', !!screenshotOneKey);
  console.log('Target URL:', url);

  if (!screenshotOneKey) {
    return {
      success: false,
      error: 'ScreenshotOne API key not configured in environment variables'
    };
  }

  try {
    // Build API parameters with safe defaults
    const params = new URLSearchParams({
      access_key: screenshotOneKey,
      url: url,
      scenario: 'scroll',
      format: (options && options.format) || 'mp4',
      duration: (options && options.duration) || '5',
      scroll_duration: '1500',
      scroll_start_immediately: 'true',
      scroll_complete: 'true',
      viewport_width: (options && options.viewport_width) || '414',
      viewport_height: (options && options.viewport_height) || '896',
      viewport_mobile: (options && options.device_type === 'mobile') ? 'true' : 'false',
      block_ads: 'true',
      block_cookie_banners: 'true',
      block_trackers: 'true',
      timeout: '90'  // Reduced timeout to avoid Netlify function timeout
    });

    const apiUrl = `https://api.screenshotone.com/animate?${params}`;

    console.log('Calling ScreenshotOne API...');
    console.log('Duration:', (options && options.duration) || '5', 'seconds');
    console.log('Viewport:', ((options && options.viewport_width) || '414') + 'x' + ((options && options.viewport_height) || '896'));

    const startTime = Date.now();

    // Set a timeout for the fetch request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'ScreenRecorderPro-API/1.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('ScreenshotOne response:');
    console.log('- Status:', response.status);
    console.log('- Duration:', duration.toFixed(2), 'seconds');
    console.log('- Content-Type:', response.headers.get('content-type'));

    if (response.ok) {
      const videoBuffer = await response.buffer();
      console.log('✅ Video received:', videoBuffer.length, 'bytes');

      // Check if we actually got video data
      if (videoBuffer.length === 0) {
        return {
          success: false,
          error: 'ScreenshotOne returned empty response'
        };
      }

      // Convert to base64 for transport to WordPress
      const videoBase64 = videoBuffer.toString('base64');

      return {
        success: true,
        video_data: videoBase64,
        file_size: videoBuffer.length,
        duration: parseInt((options && options.duration) || '5'),
        api_duration: duration
      };
    } else {
      const errorText = await response.text();
      console.log('❌ ScreenshotOne error response:', errorText);

      return {
        success: false,
        error: `ScreenshotOne API failed with status ${response.status}: ${errorText}`
      };
    }

  } catch (error) {
    console.error('❌ ScreenshotOne API error:', error);

    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'ScreenshotOne API request timed out (90 seconds)'
      };
    }

    return {
      success: false,
      error: `Network error: ${error.message}`
    };
  }
}

// Track usage (simple logging for now)
async function incrementUsage(licenseKey, siteUrl, targetUrl) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      license_key: licenseKey ? licenseKey.substring(0, 8) + '...' : 'none',
      site_url: siteUrl,
      target_url: targetUrl
    };

    console.log('📊 Usage tracked:', JSON.stringify(logEntry));
  } catch (error) {
    console.error('Usage tracking error:', error);
  }
}