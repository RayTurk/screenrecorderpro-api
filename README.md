# Screen Recorder Pro API

This is the API server for the Screen Recorder Pro WordPress plugin.

## Endpoints

- POST /.netlify/functions/create-recording - Create a new screen recording
- GET/POST /.netlify/functions/validate-license - Validate plugin license

## Environment Variables

- SCREENSHOTONE_API_KEY - Your ScreenshotOne.com API access key

## Deployment

This API is deployed on Netlify Functions and scales automatically.
