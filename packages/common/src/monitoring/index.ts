import { PerformanceMonitor } from './performance-monitor.js';

export {
  PerformanceMonitor,
  type PerformanceMetrics,
  type PerformanceEvent,
} from './performance-monitor.js';

// Create singleton performance monitor
export const performanceMonitor = new PerformanceMonitor(10000, 60000);