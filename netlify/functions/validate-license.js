// netlify/functions/validate-license.js

exports.handler = async (event, context) => {
  console.log('=== License Validation Endpoint ===');
  console.log('Method:', event.httpMethod);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Plugin-License',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS OK' })
    };
  }

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Screen Recorder Pro API is online',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method not allowed' })
    };
  }

  try {
    const requestBody = JSON.parse(event.body);
    const { license_key, site_url } = requestBody;

    console.log('Validating license for:', site_url);

    const isValid = license_key === 'free' || (license_key && license_key.length > 10);
    const plan = license_key === 'free' ? 'free' : 'starter';

    return {
      statusCode: isValid ? 200 : 403,
      headers,
      body: JSON.stringify({
        valid: isValid,
        plan: plan,
        site_url: site_url,
        message: isValid ? 'License valid' : 'Invalid license'
      })
    };

  } catch (error) {
    console.error('Validation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Validation error',
        error: error.message
      })
    };
  }
};