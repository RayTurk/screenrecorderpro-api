// netlify/functions/create-recording.js
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('=== Screen Recorder Pro API Called ===');
  console.log('Method:', event.httpMethod);
  console.log('Headers:', event.headers);
  
  // Add CORS headers for WordPress integration
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
    console.log('Raw request body:', event.body);
    
    // Parse request data
    const requestData = JSON.parse(event.body);
    const { url, options, license_key, site_url, user_id, plugin_version } = requestData;
    
    // Get license from headers (WordPress sends it here)
    const licenseHeader = event.headers['x-plugin-license'] || license_key || 'free';
    
    console.log('=== Request Details ===');
    console.log('License key:', licenseHeader);
    console.log('Site URL:', site_url);
    console.log('Target URL:', url);
    console.log('Plugin version:', plugin_version);
    console.log('Options:', JSON.stringify(options, null, 2));
    
    // Validate required fields
    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'URL is required' })
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
        body: JSON.stringify({ message: licenseCheck.message })
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
          limit: usageCheck.limit
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
          message: 'Failed to create recording: ' + recordingResult.error
        })
      };
    }
    
  } catch (error) {
    console.error('❌ API Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        message: 'Internal server error',
        error: error.message,
        stack: error.stack
      })
    };
  }
};

// Validate license function
async function validateLicense(licenseKey, siteUrl) {
  console.log('Validating license:', licenseKey?.substring(0, 8) + '...');
  
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
}

// Check usage limits
async function checkUsageLimits(licenseKey, plan) {
  const limits = {
    'free': { type: 'total', limit: 1 },
    'starter': { type: 'monthly', limit: 50 },
    'pro': { type: 'monthly', limit: 200 },
    'agency': { type: 'monthly', limit: 500 }
  };
  
  const planLimits = limits[plan] || limits['free'];
  let currentUsage = 0;
  
  if (plan === 'free') {
    currentUsage = 0; // WordPress handles the limit
  } else {
    currentUsage = 0; // Paid users start at 0
  }
  
  const canCreate = currentUsage < planLimits.limit;
  
  console.log(Usage: / for plan "");
  
  return {
    can_create: canCreate,
    current_usage: currentUsage,
    limit: planLimits.limit,
    message: canCreate ? 'Usage OK' : Usage limit reached (/)
  };
}

// Call ScreenshotOne API
async function callScreenshotOneAPI(url, options) {
  const screenshotOneKey = process.env.SCREENSHOTONE_API_KEY;
  
  console.log('ScreenshotOne API key configured:', !!screenshotOneKey);
  
  if (!screenshotOneKey) {
    return {
      success: false,
      error: 'ScreenshotOne API key not configured'
    };
  }
  
  // Build API parameters
  const params = new URLSearchParams({
    access_key: screenshotOneKey,
    url: url,
    scenario: 'scroll',
    format: options.format || 'mp4',
    duration: options.duration || '5',
    scroll_duration: '1500',
    scroll_start_immediately: 'true',
    scroll_complete: 'true',
    viewport_width: options.viewport_width || '414',
    viewport_height: options.viewport_height || '896',
    viewport_mobile: options.device_type === 'mobile' ? 'true' : 'false',
    block_ads: 'true',
    block_cookie_banners: 'true',
    block_trackers: 'true',
    timeout: '60'
  });
  
  const apiUrl = https://api.screenshotone.com/animate?;
  
  console.log('Calling ScreenshotOne API...');
  
  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'ScreenRecorderPro-API/1.0'
      },
      timeout: 120000
    });
    
    console.log('ScreenshotOne response status:', response.status);
    
    if (response.ok) {
      const videoBuffer = await response.buffer();
      console.log('Video size:', videoBuffer.length, 'bytes');
      
      const videoBase64 = videoBuffer.toString('base64');
      
      return {
        success: true,
        video_data: videoBase64,
        file_size: videoBuffer.length,
        duration: parseInt(options.duration) || 5
      };
    } else {
      const errorText = await response.text();
      console.log('ScreenshotOne error:', errorText);
      
      return {
        success: false,
        error: ScreenshotOne API failed: HTTP 
      };
    }
    
  } catch (error) {
    console.error('ScreenshotOne API error:', error);
    return {
      success: false,
      error: Network error: 
    };
  }
}

// Track usage
async function incrementUsage(licenseKey, siteUrl, targetUrl) {
  const timestamp = new Date().toISOString();
  console.log('📊 Usage tracked:', timestamp, licenseKey?.substring(0, 8) + '...', siteUrl);
}
