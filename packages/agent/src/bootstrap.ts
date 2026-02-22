// Must be imported FIRST — sets max listeners before pino creates transports
import process from 'node:process';
process.setMaxListeners(20);
