/**
 * Test: Execute API with mock WASM
 * 
 * This tests the full flow:
 * 1. Register actor (already done - hello-world)
 * 2. Execute actor
 * 3. Get result
 */

async function testExecuteAPI() {
  const baseUrl = 'http://localhost:8080';

  console.log('🧪 Testing Execute API...\n');

  // Test 1: Execute the hello-world actor
  console.log('📤 Executing hello-world actor...');
  const executeResponse = await fetch(`${baseUrl}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actorType: 'hello-world',
      input: { name: 'Loom' },
    }),
  });

  const result = await executeResponse.json();
  console.log('📥 Result:', JSON.stringify(result, null, 2));

  // Test 2: Execute with invalid input (should fail validation)
  console.log('\n❌ Testing validation failure...');
  const invalidResponse = await fetch(`${baseUrl}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actorType: 'hello-world',
      input: { }, // Missing required "name" field
    }),
  });

  const invalidResult = await invalidResponse.json();
  console.log('📥 Validation error:', JSON.stringify(invalidResult, null, 2));

  // Test 3: Execute non-existent actor
  console.log('\n❌ Testing unknown actor...');
  const notFoundResponse = await fetch(`${baseUrl}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actorType: 'non-existent-actor',
      input: { test: 'data' },
    }),
  });

  const notFoundResult = await notFoundResponse.json();
  console.log('📥 Not found error:', JSON.stringify(notFoundResult, null, 2));

  console.log('\n✅ Execute API tests complete!');
}

testExecuteAPI().catch(console.error);
