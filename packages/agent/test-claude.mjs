import { query } from '@anthropic-ai/claude-code';
import 'dotenv/config';

console.log('API key present:', !!process.env.ANTHROPIC_API_KEY);
console.log('API key prefix:', process.env.ANTHROPIC_API_KEY?.slice(0, 10) + '...');

try {
  console.log('Starting query...');
  const stream = query({
    prompt: 'Say hello in one word',
    options: {
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 1,
      permissionMode: 'bypassPermissions',
      cwd: process.cwd(),
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
      },
      stderr: (data) => {
        console.error('STDERR:', data);
      },
    },
  });

  for await (const msg of stream) {
    console.log('MSG:', JSON.stringify(msg).slice(0, 200));
  }
  console.log('Done!');
} catch (err) {
  console.error('ERROR:', err.message);
  console.error('STACK:', err.stack);
}
