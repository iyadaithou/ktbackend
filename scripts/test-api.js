/**
 * Simple script to test API endpoints
 * Run with: node scripts/test-api.js
 */
require('dotenv').config();
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3001';

async function testHealthEndpoint() {
  try {
    console.log('Testing health endpoint...');
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    console.log('Health endpoint response:', data);
    return data;
  } catch (error) {
    console.error('Error testing health endpoint:', error.message);
  }
}

// Run tests
async function runTests() {
  await testHealthEndpoint();
  // Add more test functions here as needed
}

runTests(); 