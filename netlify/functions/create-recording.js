// Replace your Netlify function file: .netlify/functions/create-recording.js

const crypto = require('crypto');

exports.handler = async (event, context) => {
  // Set shorter timeout for free tier
  context.callbackWaitsForEmptyEventLoop = false;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { url, options = {} } = data;

    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'URL is required' })
      };
    }

    console.log('Creating recording for URL:', url);
    console.log('Received options:', JSON.stringify(options));

    // Use the timeout from options, with a fallback
    const apiTimeout = options.timeout || 5; // Use 5 as fallback instead of 8
    const scrollDuration = options.scroll_duration || 500;

    console.log('Using API timeout:', apiTimeout, 'seconds');
    console.log('Using scroll duration:', scrollDuration, 'ms');

    // Build ScreenshotOne API URL with optimized parameters
    const screenshotOneParams = new URLSearchParams({
      access_key: process.env.SCREENSHOTONE_API_KEY,
      url: url,
      format: options.format || 'mp4',
      duration: Math.min(options.duration || 3, 5), // Cap at 5 seconds
      scenario: 'scroll',
      viewport_width: options.viewport_width || 820,
      viewport_height: options.viewport_height || 1180,
      viewport_mobile: false,

      // Optimized settings for speed
      timeout: apiTimeout, // Use the passed timeout
      scroll_duration: scrollDuration,
      scroll_start_immediately: true,
      scroll_complete: true,
      block_ads: true,
      block_cookie_banners: true,
      block_trackers: true,
      delay: 0, // No initial delay
      wait_for_network_idle: false // Don't wait for network idle
    });

    const apiUrl = `https://api.screenshotone.com/animate?${screenshotOneParams.toString()}`;
    console.log('ScreenshotOne API URL:', apiUrl.replace(process.env.SCREENSHOTONE_API_KEY, 'HIDDEN'));

    // Create recording with fetch and shorter timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), (apiTimeout + 1) * 1000); // 1 second buffer

    try {
      const response = await fetch(apiUrl, {
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
          headers,
          body: JSON.stringify({
            message: `ScreenshotOne API error: ${response.status} ${response.statusText}`
          })
        };
      }

      // Get video as buffer
      const videoBuffer = await response.arrayBuffer();
      const videoBase64 = Buffer.from(videoBuffer).toString('base64');

      console.log('Recording created successfully, size:', videoBuffer.byteLength, 'bytes');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          video_data: videoBase64,
          duration: options.duration || 3,
          size: videoBuffer.byteLength
        })
      };

    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError.name === 'AbortError') {
        console.error('ScreenshotOne API request timed out after', apiTimeout, 'seconds');
        return {
          statusCode: 504,
          headers,
          body: JSON.stringify({
            message: `ScreenshotOne API request timed out (${apiTimeout} seconds). Try reducing the duration or using a simpler page.`
          })
        };
      }

      console.error('ScreenshotOne API request failed:', fetchError.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: `Failed to create recording: ${fetchError.message}`
        })
      };
    }

  } catch (error) {
    console.error('Netlify function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error: ' + error.message
      })
    };
  }
};