#!/usr/bin/env node

/**
 * Trello Integration Test Suite
 * Run with: node test-trello-integration.js
 */

const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'https://backend-pythagoras.vercel.app';
const BASE_URL = `${BACKEND_URL}/api`;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name) {
  console.log('\n' + '='.repeat(60));
  log(`TEST: ${name}`, 'cyan');
  console.log('='.repeat(60));
}

function logPass(message) {
  log(`✅ PASS: ${message}`, 'green');
}

function logFail(message) {
  log(`❌ FAIL: ${message}`, 'red');
}

function logWarn(message) {
  log(`⚠️  WARN: ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  INFO: ${message}`, 'blue');
}

// Test results tracker
const results = {
  passed: 0,
  failed: 0,
  warnings: 0
};

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test 1: Check Trello Configuration
 */
async function testTrelloConfig() {
  logTest('Trello Configuration');
  
  try {
    const response = await axios.get(`${BASE_URL}/trello-setup/test`, { timeout: 15000 });
    const data = response.data;
    
    if (data.apiKey) {
      logPass('Trello API Key configured');
    } else {
      logFail('Trello API Key missing');
      results.failed++;
    }
    
    if (data.token) {
      logPass('Trello Token configured');
    } else {
      logFail('Trello Token missing');
      results.failed++;
    }
    
    if (data.boardId) {
      logPass('Trello Board ID configured');
      logInfo(`Board ID: ${data.boardId}`);
    } else {
      logFail('Trello Board ID missing');
      results.failed++;
    }
    
    if (data.lists && data.lists.length > 0) {
      logPass(`Found ${data.lists.length} Trello lists`);
      data.lists.forEach((list, index) => {
        logInfo(`  ${index + 1}. ${list.name} (ID: ${list.id})`);
      });
      results.passed++;
    } else {
      logFail('No Trello lists found');
      results.failed++;
    }
    
    if (data.webhook) {
      logPass('Trello webhook is active');
      logInfo(`Webhook ID: ${data.webhook.id}`);
      logInfo(`Callback URL: ${data.webhook.callbackURL}`);
      results.passed++;
    } else {
      logWarn('Trello webhook not found - may need to create it');
      logInfo('Visit: /api/trello-setup/webhook to create');
      results.warnings++;
    }
    
  } catch (error) {
    logFail(`Failed to check Trello config: ${error.message}`);
    if (error.response) {
      logInfo(`Response status: ${error.response.status}`);
      logInfo(`Response data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    results.failed++;
  }
}

/**
 * Test 2: Check Backend Routes
 */
async function testBackendRoutes() {
  logTest('Backend Routes');
  
  const routes = [
    { path: '/trello-public/lists', name: 'Public Trello Lists' },
    { path: '/trello-setup/test', name: 'Trello Setup Test' }
  ];
  
  for (const route of routes) {
    try {
      const response = await axios.get(`${BASE_URL}${route.path}`, { timeout: 10000 });
      logPass(`${route.name} endpoint accessible`);
      results.passed++;
    } catch (error) {
      if (error.response?.status === 404) {
        logFail(`${route.name} endpoint not found (404)`);
      } else {
        logWarn(`${route.name} endpoint error: ${error.message}`);
      }
      results.failed++;
    }
  }
}

/**
 * Test 3: Verify Environment Variables
 */
async function testEnvironmentVars() {
  logTest('Environment Variables Check');
  
  try {
    const response = await axios.get(`${BASE_URL}/trello-setup/test`, { timeout: 10000 });
    const data = response.data;
    
    const envVars = [
      { name: 'TRELLO_API_KEY', present: !!data.apiKey },
      { name: 'TRELLO_TOKEN', present: !!data.token },
      { name: 'TRELLO_BOARD_ID', present: !!data.boardId },
      { name: 'BACKEND_URL', present: true }
    ];
    
    envVars.forEach(env => {
      if (env.present) {
        logPass(`${env.name} is set`);
        results.passed++;
      } else {
        logFail(`${env.name} is NOT set`);
        results.failed++;
      }
    });
    
  } catch (error) {
    logFail('Could not verify environment variables');
    results.failed++;
  }
}

/**
 * Test 4: Test Webhook Endpoint
 */
async function testWebhookEndpoint() {
  logTest('Webhook Endpoint');
  
  try {
    // Test HEAD request (webhook verification)
    const headResponse = await axios.head(`${BACKEND_URL}/api/webhooks/trello`, { timeout: 5000 });
    if (headResponse.status === 200) {
      logPass('Webhook endpoint responds to HEAD requests (Trello verification)');
      results.passed++;
    }
  } catch (error) {
    logFail(`Webhook HEAD request failed: ${error.message}`);
    results.failed++;
  }
  
  try {
    // Test POST with minimal payload (should be ignored gracefully)
    const postResponse = await axios.post(`${BACKEND_URL}/api/webhooks/trello`, {
      action: { type: 'commentCard' }
    }, { timeout: 5000 });
    
    if (postResponse.status === 200) {
      logPass('Webhook endpoint accepts POST requests');
      results.passed++;
    }
  } catch (error) {
    logWarn(`Webhook POST test: ${error.message}`);
    results.warnings++;
  }
}

/**
 * Test 5: Notification Configuration
 */
async function testNotificationConfig() {
  logTest('Notification Configuration');
  
  logInfo('Checking email/SMS provider status from backend logs...');
  logInfo('Expected providers: Brevo (primary) or SendGrid/Twilio (fallback)');
  
  logWarn('Email provider check: Manual verification needed');
  logWarn('SMS provider check: Manual verification needed');
  logInfo('To verify: Check backend deployment logs at Vercel');
  logInfo('Look for: "Email/SMS Configuration Status"');
  
  results.warnings += 2;
}

/**
 * Test 6: Database Schema
 */
async function testDatabaseSchema() {
  logTest('Database Schema');
  
  logInfo('Required columns in translation_orders table:');
  const requiredColumns = [
    'trello_card_id',
    'trello_list_id',
    'trello_list_name',
    'status'
  ];
  
  requiredColumns.forEach(col => {
    logInfo(`  - ${col}`);
  });
  
  logInfo('\nRequired table: translation_order_events');
  const eventColumns = [
    'order_id',
    'order_code',
    'trello_card_id',
    'from_list_id',
    'from_list_name',
    'to_list_id',
    'to_list_name',
    'created_at'
  ];
  
  eventColumns.forEach(col => {
    logInfo(`  - ${col}`);
  });
  
  logWarn('Database schema: Manual verification needed via Supabase dashboard');
  results.warnings++;
}

/**
 * Test 7: Frontend Integration
 */
async function testFrontendEndpoints() {
  logTest('Frontend Integration Points');
  
  try {
    const response = await axios.get(`${BASE_URL}/trello-public/lists`, { timeout: 10000 });
    if (response.data && response.data.lists && response.data.lists.length > 0) {
      logPass(`Public lists endpoint working (${response.data.lists.length} lists)`);
      results.passed++;
    } else {
      logFail('Public lists endpoint returned no lists');
      results.failed++;
    }
  } catch (error) {
    logFail(`Public lists endpoint failed: ${error.message}`);
    results.failed++;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  log('\n' + '█'.repeat(60), 'cyan');
  log('  TRELLO INTEGRATION TEST SUITE', 'cyan');
  log('█'.repeat(60) + '\n', 'cyan');
  
  logInfo(`Testing backend at: ${BACKEND_URL}`);
  logInfo('Starting tests...\n');
  
  await testTrelloConfig();
  await delay(1000);
  
  await testBackendRoutes();
  await delay(1000);
  
  await testEnvironmentVars();
  await delay(1000);
  
  await testWebhookEndpoint();
  await delay(1000);
  
  await testNotificationConfig();
  await delay(1000);
  
  await testDatabaseSchema();
  await delay(1000);
  
  await testFrontendEndpoints();
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  log('TEST SUMMARY', 'cyan');
  console.log('='.repeat(60));
  logPass(`Passed: ${results.passed}`);
  logFail(`Failed: ${results.failed}`);
  logWarn(`Warnings: ${results.warnings}`);
  console.log('='.repeat(60) + '\n');
  
  if (results.failed > 0) {
    log('❌ Some tests failed. Please review the output above.', 'red');
    log('Check TESTING_GUIDE.md for troubleshooting steps.', 'yellow');
    process.exit(1);
  } else if (results.warnings > 0) {
    log('⚠️  All critical tests passed, but some require manual verification.', 'yellow');
    log('See warnings above for details.', 'yellow');
  } else {
    log('✅ All tests passed! Trello integration is ready.', 'green');
  }
}

// Run the tests
runTests().catch(error => {
  log(`\n❌ Test suite crashed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

