import { ResourceMonitor, type ResourceLimits } from './resource-monitor.js';

/**
 * Simple test for ResourceMonitor graceful degradation
 */
async function testGracefulDegradation() {
  console.log('Starting ResourceMonitor graceful degradation test...');

  // Configure very low limits for testing
  const limits: ResourceLimits = {
    maxMemoryMB: 100, // Very low limit to trigger warnings
    maxCpuPercent: 10, // Very low CPU limit
    taskTimeoutMs: 5000, // 5 second timeout
    healthCheckIntervalMs: 1000, // Check every second
  };

  const monitor = new ResourceMonitor(limits);

  // Set up event listeners
  monitor.on('resource-limit', (event) => {
    console.log(`🚨 Resource limit event: ${event.type} for ${event.resource}`);
    console.log(`   Usage: ${event.usage.toFixed(1)}% (limit: ${event.limit})`);
    console.log(`   Health Score: ${event.status.healthScore.toFixed(1)}`);
    console.log(`   Can Accept Tasks: ${monitor.canAcceptNewTasks()}`);
    console.log();
  });

  // Start monitoring
  monitor.startMonitoring();

  // Test timeout controller
  console.log('Testing task timeout controller...');
  const controller = monitor.createTaskTimeoutController();

  const timeoutPromise = new Promise<void>((resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      console.log('✅ Task timeout controller worked correctly');
      resolve();
    });

    // This should timeout after 5 seconds
    setTimeout(() => {
      reject(new Error('Timeout controller did not abort within expected time'));
    }, 6000);
  });

  try {
    await timeoutPromise;
  } catch (error) {
    console.error('❌ Timeout controller test failed:', error);
  }

  // Display current status
  console.log('📊 Current Resource Status:');
  const status = monitor.reportStatus();
  console.log(`   Memory: ${status.memory.percentUsed.toFixed(1)}% (${status.memory.status})`);
  console.log(`   CPU: ${status.cpu.percent.toFixed(1)}% (${status.cpu.status})`);
  console.log(`   Health Score: ${status.healthScore.toFixed(1)}/100`);
  console.log(`   Can Accept Tasks: ${monitor.canAcceptNewTasks()}`);
  console.log(`   Should Shutdown: ${monitor.shouldShutdown()}`);

  // Wait a few seconds to let monitoring run
  console.log('\nMonitoring for 10 seconds to observe behavior...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Stop monitoring
  monitor.stopMonitoring();
  console.log('\n✅ ResourceMonitor test completed');
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testGracefulDegradation().catch(console.error);
}

export { testGracefulDegradation };